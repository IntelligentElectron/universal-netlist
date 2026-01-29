/**
 * User interaction utilities for CLI prompts.
 */

import * as readline from "node:readline";

/**
 * Prompt user for confirmation with a y/N prompt.
 * @param question - The question to ask the user
 * @returns Promise resolving to true if user confirms, false otherwise
 */
export const confirm = async (question: string): Promise<boolean> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
};
