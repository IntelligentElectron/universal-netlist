/**
 * The environment an external program runs in: this process's, without the design
 * passwords only this process reads.
 */

import { DSN_PASSWORD, DSN_PASSWORD_FILE } from "./parsers/cadence/dsn/dsn-reader.js";

export const childEnvironment = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env[DSN_PASSWORD];
  delete env[DSN_PASSWORD_FILE];
  return env;
};
