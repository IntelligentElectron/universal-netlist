/** Stable, low-cardinality failure categories used by tool telemetry. */
export const TOOL_ERROR_TYPES = [
  "invalid_argument",
  "not_found",
  "permission_denied",
  "resource_exhausted",
  "cancelled",
  "timeout",
  "unavailable",
  "internal",
] as const;

export type ToolErrorType = (typeof TOOL_ERROR_TYPES)[number];

const CODE_TYPES: Readonly<Record<string, ToolErrorType>> = {
  ABORT_ERR: "cancelled",
  ECANCELED: "cancelled",
  ERR_CANCELED: "cancelled",
  EACCES: "permission_denied",
  EPERM: "permission_denied",
  ENOENT: "not_found",
  ENOTDIR: "not_found",
  EISDIR: "invalid_argument",
  ERR_BUFFER_OUT_OF_BOUNDS: "invalid_argument",
  ENOSPC: "resource_exhausted",
  ENOMEM: "resource_exhausted",
  EMFILE: "resource_exhausted",
  ENFILE: "resource_exhausted",
  ETIMEDOUT: "timeout",
  ECONNREFUSED: "unavailable",
  ECONNRESET: "unavailable",
  EHOSTUNREACH: "unavailable",
  ENETUNREACH: "unavailable",
  EPIPE: "unavailable",
};

/** A Node error code written ahead of its text, as in `EPERM: operation not permitted`. */
const MESSAGE_CODE = /\b([A-Z][A-Z_]{3,}): /g;

/**
 * Quoted names and paths, which never state the cause; the whole message is the fallback.
 * An apostrophe between letters, as in `Bob's`, belongs to the name.
 */
const QUOTED = /(?<!\w)'(?:[^'\n]|(?<=\w)'(?=\w))*'(?!\w)|"[^"\n]*"/g;

const MESSAGE_TYPES: ReadonlyArray<readonly [ToolErrorType, RegExp]> = [
  // Messages whose names are unquoted: the file, the requested tool, the rule ids.
  ["invalid_argument", /^[^\n]*\.netlist\.json: /i],
  ["not_found", /^(?:MCP error -?\d+: )?Tool .+ not found$/i],
  ["invalid_argument", /^Unknown rule id\(s\): /i],
  [
    "permission_denied",
    /\b(?:eacces|eperm|permission denied|access denied|unauthori[sz]ed|forbidden|password-protected|no password in)\b/i,
  ],
  // Design data read at a byte offset: a length past a format limit is malformed data.
  ["invalid_argument", /\bat offset \d+/i],
  [
    "resource_exhausted",
    /\b(?:enospc|enomem|emfile|enfile|out of memory|resource exhausted|too many open files|maxbuffer|exceeds? (?:the )?limit|payload too large)\b/i,
  ],
  ["cancelled", /\b(?:abort_err|ecanceled|err_canceled|cancelled|canceled|aborted)\b/i],
  ["timeout", /\b(?:etimedout|timed out|timeout|deadline exceeded)\b/i],
  [
    "unavailable",
    /\b(?:econnrefused|econnreset|ehostunreach|enetunreach|epipe|connection refused|connection reset|network unreachable|service unavailable|temporarily unavailable|only available on|no cadence spb installation|pstswp failed|kicad-cli not found|kicad-cli netlist export failed)\b/i,
  ],
  // A design with neither a netlist export nor a root schematic.
  ["not_found", /\b(?:no netlist for|enotdir)\b/i],
  [
    "invalid_argument",
    /\b(?:eisdir|outside (?:of )?(?:the )?(?:buffer )?bounds|invalid|unsupported|malformed|corrupt(?:ed|ion)?|not an?|unexpected|unbalanced|unterminated|expected|must|needs?|missing required|unknown rule|was empty|cannot be queried|matched all|out of bounds|magic signature mismatch|could not find valid|no schematic documents found|no hierarchy stream|defines design variants|encrypted in a format|no encrypted library stream)\b/i,
  ],
  ["invalid_argument", /\blists\b.+\bbut\b.+\bis on\b/i],
  ["invalid_argument", /\b(?:stream|section|signature|terminator)\b.+\bnot found\b/i],
  ["not_found", /\b(?:enoent|no such file|does not exist)\b/i],
  [
    "not_found",
    /\b(?:file|directory|design|variant|component|net|pin|path|tool|resource)\b.+\bnot found\b/i,
  ],
  ["not_found", /\bno (?:components?|nets?|pins?|designs?|files?|directories)\b.+\bfound\b/i],
];

/**
 * Classify either a thrown value or an MCP error-result message.
 *
 * Unknown failures intentionally become `internal`: gaps remain visible instead
 * of silently growing the vocabulary or inventing a category from free text.
 */
export const classifyToolError = (failure: unknown): ToolErrorType => {
  try {
    const code = readStringProperty(failure, "code")?.toUpperCase();
    if (code && CODE_TYPES[code]) return CODE_TYPES[code];

    const cause = readProperty(failure, "cause");
    const causeCode = readStringProperty(cause, "code")?.toUpperCase();
    if (causeCode && CODE_TYPES[causeCode]) return CODE_TYPES[causeCode];

    const message = describeFailure(failure);
    for (const [, messageCode] of message.matchAll(MESSAGE_CODE)) {
      if (CODE_TYPES[messageCode]) return CODE_TYPES[messageCode];
    }
    for (const text of [message.replace(QUOTED, " "), message]) {
      for (const [type, pattern] of MESSAGE_TYPES) {
        if (pattern.test(text)) return type;
      }
    }
  } catch {
    // Telemetry classification must never affect the tool call.
  }
  return "internal";
};

/** Keep the runtime exception class for debugging, separate from `error.type`. */
export const getErrorClass = (failure: unknown): string | undefined => {
  try {
    if (!(failure instanceof Error)) return undefined;
    return failure.name || "Error";
  } catch {
    return undefined;
  }
};

const describeFailure = (failure: unknown): string => {
  try {
    if (failure instanceof Error) return failure.message;
    return typeof failure === "string" ? failure : String(failure);
  } catch {
    return "";
  }
};

const readProperty = (value: unknown, property: string): unknown => {
  try {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
      return undefined;
    }
    return (value as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
};

const readStringProperty = (value: unknown, property: string): string | undefined => {
  const candidate = readProperty(value, property);
  return typeof candidate === "string" ? candidate : undefined;
};
