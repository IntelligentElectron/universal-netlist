/**
 * Vitest global setup.
 *
 * `test/fixtures` is a git submodule, absent from source tarballs, shallow or
 * non-recursive clones, and vendored copies. Every fixture-backed suite skips
 * itself when it is missing, which leaves a green run with a much smaller test
 * count and nothing saying why. Say it once, at the top of the run.
 */

import { hasFixtures } from "./utils.js";

export default (): void => {
  if (hasFixtures) return;

  console.log(
    "\ntest/fixtures is not checked out, so fixture-backed suites will skip." +
      "\nRun `npm run setup` to fetch them.\n"
  );
};
