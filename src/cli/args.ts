/**
 * Command-line argument normalization.
 *
 * Every command is accepted both as a word and as a flag: `universal-netlist
 * update` and `universal-netlist --update` are the same call, and so is
 * `upgrade`, an alias of `update`. The rest of the program reads the flag form
 * of the command's own name, so this rewrites every other spelling into it
 * before anything else looks at the arguments.
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

/** Other spellings of a command, each rewritten to the command it names. */
export const ALIASES: Record<string, (typeof COMMANDS)[number]> = {
  upgrade: "update",
};

/** Commands followed by a value. `required` means the next token is always the value. */
const TAKES_VALUE: Record<string, "required" | "optional"> = {
  "export-json": "required",
  coverage: "optional",
};

/** The command a token names, as a word, or undefined when it names none. */
const commandOf = (token: string): string | undefined => {
  const word = token.startsWith("--") ? token.slice(2) : token;
  if (COMMAND_SET.has(word)) return word;
  return ALIASES[word];
};

const isCommandToken = (token: string): boolean => commandOf(token) !== undefined;

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

    const command = commandOf(token);
    if (command !== undefined) {
      out.push(`--${command}`);
      valueFor = TAKES_VALUE[command];
      continue;
    }
    out.push(token);
  }

  return out;
};
