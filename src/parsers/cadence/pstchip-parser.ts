/**
 * Parser for Cadence .pstchip.dat files
 * Extracts part and pin information
 */

import { readFile } from "fs/promises";

/**
 * Part information from Cadence pstchip.dat.
 * Used for pin name mapping and value extraction.
 */
export interface ChipPart {
  part_name: string;
  pins: Record<string, string>;
  body_properties: Record<string, string>;
}

/**
 * Parse a .pstchip.dat file and extract part information.
 * Pure function that reads from disk and returns parsed data.
 */
export const parsePstchip = async (filePath: string): Promise<ChipPart[]> => {
  const content = await readFile(filePath, "utf-8");
  return parsePstchipContent(content);
};

/**
 * Parse pstchip file content (pure function for testing).
 */
export const parsePstchipContent = (content: string): ChipPart[] => {
  const lines = content.split("\n").map((line) => line.trim());

  const parts: ChipPart[] = [];
  let currentPartName: string | null = null;
  let currentPins: Record<string, string> = {};
  let currentBody: Record<string, string> = {};
  let inPin = false;
  let inBody = false;
  let currentPinName: string | null = null;

  const saveCurrentPart = (): void => {
    if (currentPartName !== null) {
      parts.push({
        part_name: currentPartName,
        pins: currentPins,
        body_properties: currentBody,
      });
    }
  };

  for (const line of lines) {
    if (line.startsWith("primitive ")) {
      saveCurrentPart();

      const match = line.match(/primitive\s+'([^']+)'/);
      currentPartName = match ? match[1] : null;
      currentPins = {};
      currentBody = {};
      inPin = false;
      inBody = false;
    } else if (line === "pin") {
      inPin = true;
      inBody = false;
    } else if (line === "end_pin;") {
      inPin = false;
      currentPinName = null;
    } else if (line === "body") {
      inBody = true;
      inPin = false;
    } else if (inPin && line.startsWith("'") && line.includes(":")) {
      const match = line.match(/'([^']+)':/);
      if (match) {
        currentPinName = match[1];
      }
    } else if (inPin && line.includes("PIN_NUMBER") && currentPinName) {
      const parts = line.split("=", 2);
      if (parts.length === 2) {
        const value = parts[1].trim().replace(/^['";()]+|['";()]+$/g, "");
        currentPins[currentPinName] = value;
      }
    } else if (inBody && line.includes("=")) {
      const [key, ...valueParts] = line.split("=");
      const value = valueParts
        .join("=")
        .trim()
        .replace(/^['"]|['";]+$/g, "");
      currentBody[key.trim()] = value;
    }
  }

  saveCurrentPart();

  return parts;
};
