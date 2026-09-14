/** Sapphire II decryption for OrCAD FILE_FMT_SYENCRYPT01. Inputs are not modified. */
export function decryptSapphireII(ciphertext: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length === 0 || key.length > 255) {
    throw new Error("SYENCRYPT01 requires a key of 1..255 bytes");
  }
  const cards = Uint8Array.from({ length: 256 }, (_, i) => i);
  let keyPosition = 0;
  let sum = 0;
  for (let top = 255; top >= 0; top--) {
    let mask = 1;
    while (mask < top) mask = mask * 2 + 1;
    let attempts = 0;
    let candidate: number;
    do {
      sum = (cards[sum] + key[keyPosition]) & 255;
      keyPosition = (keyPosition + 1) & 255;
      if (keyPosition >= key.length) {
        keyPosition = 0;
        sum = (sum + key.length) & 255;
      }
      candidate = sum & mask;
      // OrCAD's final slot still consumes key material.
      if (++attempts > 11) candidate = top === 0 ? 0 : candidate % top;
    } while (candidate > top);
    [cards[top], cards[candidate]] = [cards[candidate], cards[top]];
  }
  let rotor = cards[1];
  let ratchet = cards[3];
  let avalanche = cards[5];
  let lastPlain = cards[7];
  let lastCipher = cards[sum];
  const plaintext = new Uint8Array(ciphertext.length);
  for (let pos = 0; pos < ciphertext.length; pos++) {
    ratchet = (ratchet + cards[rotor]) & 255;
    rotor = (rotor + 1) & 255;
    const swap = cards[lastCipher];
    // Assign sequentially: the indices can coincide.
    cards[lastCipher] = cards[ratchet];
    cards[ratchet] = cards[lastPlain];
    cards[lastPlain] = cards[rotor];
    cards[rotor] = swap;
    avalanche = (avalanche + cards[swap]) & 255;
    const cipherByte = ciphertext[pos];
    const plainByte =
      cipherByte ^
      cards[(cards[ratchet] + cards[rotor]) & 255] ^
      cards[cards[(cards[avalanche] + cards[lastCipher] + cards[lastPlain]) & 255]];
    plaintext[pos] = plainByte;
    lastPlain = plainByte;
    lastCipher = cipherByte;
  }
  cards.fill(0);
  return plaintext;
}
