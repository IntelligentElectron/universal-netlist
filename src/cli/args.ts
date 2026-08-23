/**
 * Command-line argument normalization.
 *
 * Every command is accepted both as a word and as a flag: `universal-netlist
 * update` and `universal-netlist --update` are the same call. The rest of the
 * program reads the flag form, so this turns the word form into it before
 * anything else looks at the arguments.
 *
 * A command that takes a value does not have that value rewritten: the path
 * after `export-json` is always a path, and the token after `coverage` is a
 * path unless it is itself a command word (a directory that happens to be
 * called `update` is given as `./update`).
 */

/** Every command the binary understands, in its word form. */
export const COMMANDS = [
  "version",
  "help",
  "update",
  "uninstall",
  "export-telemetry",
  "export-json",
  "coverage",
  "verbose",
] as const;

const COMMAND_SET = new Set<string>(COMMANDS);

/** Commands followed by a value. `required` means the next token is always the value. */
const TAKES_VALUE: Record<string, "required" | "optional"> = {
  "export-json": "required",
  coverage: "optional",
};

const isCommandToken = (token: string): boolean =>
  COMMAND_SET.has(token) || (token.startsWith("--") && COMMAND_SET.has(token.slice(2)));

/**
 * Rewrite command words to their flag form. Anything that is not a command
 * word, or is the value of the command before it, is left as it is.
 */
export const normalizeCliArgs = (args: readonly string[]): string[] => {
  const out: string[] = [];
  let valueFor: "required" | "optional" | undefined;

  for (const token of args) {
    if (valueFor === "required" || (valueFor === "optional" && !isCommandToken(token))) {
      out.push(token);
      valueFor = undefined;
      continue;
    }
    valueFor = undefined;

    if (COMMAND_SET.has(token)) {
      out.push(`--${token}`);
      valueFor = TAKES_VALUE[token];
      continue;
    }
    if (token.startsWith("--") && COMMAND_SET.has(token.slice(2))) {
      valueFor = TAKES_VALUE[token.slice(2)];
    }
    out.push(token);
  }

  return out;
};
