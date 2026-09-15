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

/** The text Node and Bun write after a system error code, as in `EPERM: operation not permitted`. */
const SYSTEM_ERROR_TEXT: Readonly<Record<string, string>> = {
  ECANCELED: "operation canceled",
  EACCES: "permission denied",
  EPERM: "operation not permitted",
  ENOENT: "no such file or directory",
  ENOTDIR: "not a directory",
  EISDIR: "illegal operation on a directory",
  ENOSPC: "no space left on device",
  ENOMEM: "not enough memory",
  EMFILE: "too many open files",
  ENFILE: "file table overflow",
  ETIMEDOUT: "connection timed out",
  ECONNREFUSED: "connection refused",
  ECONNRESET: "connection reset by peer",
  EHOSTUNREACH: "host is unreachable",
  ENETUNREACH: "network is unreachable",
  EPIPE: "broken pipe",
};

const SYSTEM_ERROR = /\b(E[A-Z]+): /g;

/** Messages whose shape states the category, whatever names and causes they carry. */
const MESSAGE_SHAPES: ReadonlyArray<readonly [ToolErrorType, RegExp]> = [
  ["invalid_argument", /^[^\n]*\.netlist\.json: /i],
  ["not_found", /^(?:MCP error -?\d+: )?Tool .+ not found$/i],
  ["invalid_argument", /^Unknown rule id\(s\): /i],
  ["not_found", /^No netlist for /],
  ["invalid_argument", /^No schematic documents found for project /],
  ["invalid_argument", /^Design variant '.*' needs the root \.kicad_sch beside /],
  ["timeout", /^kicad-cli netlist export failed for [\s\S]*\(timed out after \d+ms; /],
  ["unavailable", /^kicad-cli netlist export failed for /],
];

/**
 * Quoted names and paths, which never state the cause; the whole message is the fallback.
 * An apostrophe between letters, as in `Bob's`, belongs to the name.
 */
const QUOTED = /(?<!\w)'(?:[^'\n]|(?<=\w)'(?=\w))*'(?!\w)|"[^"\n]*"/g;

const MESSAGE_TYPES: ReadonlyArray<readonly [ToolErrorType, RegExp]> = [
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
    /\b(?:econnrefused|econnreset|ehostunreach|enetunreach|epipe|connection refused|connection reset|network unreachable|service unavailable|temporarily unavailable|only available on|no cadence spb installation|pstswp failed|kicad-cli not found)\b/i,
  ],
  ["not_found", /\benotdir\b/i],
  [
    "invalid_argument",
    /\b(?:eisdir|outside (?:of )?(?:the )?(?:buffer )?bounds|invalid|unsupported|malformed|corrupt(?:ed|ion)?|not an?|unexpected|unbalanced|unterminated|expected|must|needs?|missing required|unknown rule|was empty|cannot be queried|matched all|out of bounds|magic signature mismatch|could not find valid|no hierarchy stream|defines design variants|encrypted in a format|no encrypted library stream)\b/i,
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
    for (const [type, pattern] of MESSAGE_SHAPES) {
      if (pattern.test(message)) return type;
    }
    for (const match of message.matchAll(SYSTEM_ERROR)) {
      const [written, messageCode] = match;
      const text = SYSTEM_ERROR_TEXT[messageCode];
      if (text && message.startsWith(text, match.index + written.length)) {
        return CODE_TYPES[messageCode];
      }
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
