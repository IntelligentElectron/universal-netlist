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
 * after `export-json` is always a path, whatever it is called.
 */

/** Every command the binary understands, in its word form. */
export const COMMANDS = [
  "version",
  "help",
  "update",
  "uninstall",
  "export-telemetry",
  "export-json",
] as const;

const COMMAND_SET = new Set<string>(COMMANDS);

/** Other spellings of a command, each rewritten to the command it names. */
export const ALIASES: Record<string, (typeof COMMANDS)[number]> = {
  upgrade: "update",
};

/** Commands whose next token is always their value. */
const TAKES_VALUE = new Set<string>(["export-json"]);

/** The command a token names, as a word, or undefined when it names none. */
const commandOf = (token: string): string | undefined => {
  const word = token.startsWith("--") ? token.slice(2) : token;
  if (COMMAND_SET.has(word)) return word;
  return ALIASES[word];
};

/**
 * Rewrite command words to their flag form. Anything that is not a command
 * word, or is the value of the command before it, is left as it is.
 */
export const normalizeCliArgs = (args: readonly string[]): string[] => {
  const out: string[] = [];
  let valueNext = false;

  for (const token of args) {
    if (valueNext) {
      out.push(token);
      valueNext = false;
      continue;
    }

    const command = commandOf(token);
    if (command !== undefined) {
      out.push(`--${command}`);
      valueNext = TAKES_VALUE.has(command);
      continue;
    }
    out.push(token);
  }

  return out;
};
