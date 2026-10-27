/**
 * Line splitting for Altium's text files (`.PrjPcb`, `.Harness`).
 */

/**
 * Split text into lines at each LF, with every CR right before it. That reads LF, CR LF
 * and the CR CR LF a second CR LF conversion leaves behind, so no line keeps a stray CR.
 * A CR anywhere else stays part of its line.
 */
export const splitLines = (text: string): string[] => text.split(/\r*\n/);
