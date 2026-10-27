/**
 * Line splitting for Altium's text files (`.PrjPcb`, `.Harness`).
 */

/**
 * Split text into lines the way Altium's own reader (Delphi `TStrings`) does: CR LF,
 * a lone CR and a lone LF each end a line. A CR CR LF ending, which a second CR LF
 * conversion leaves behind, reads as a line followed by an empty line, so no line
 * keeps a stray CR.
 */
export const splitLines = (text: string): string[] => text.split(/\r\n|\r|\n/);
