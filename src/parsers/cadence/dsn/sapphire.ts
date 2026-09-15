/**
 * Sapphire II, the stream cipher (Michael Paul Johnson) OrCAD encrypts protected design
 * streams with. OrCAD's key schedule differs in one step: the last card, whose swap
 * partner can only be itself, still draws from the key.
 */

/** Decrypt `ciphertext` with a key of 1 to 255 bytes. */
export function decryptSapphireII(ciphertext: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length === 0 || key.length > 255) {
    throw new Error("A Sapphire II key is 1 to 255 bytes");
  }
  const cards = Uint8Array.from({ length: 256 }, (_, i) => i);
  let keyPosition = 0;
  let sum = 0;
  for (let limit = 255; limit >= 0; limit--) {
    let mask = 1;
    while (mask < limit) mask = mask * 2 + 1;
    let attempts = 0;
    let swap: number;
    do {
      sum = (cards[sum] + key[keyPosition++]) & 255;
      if (keyPosition >= key.length) {
        keyPosition = 0;
        sum = (sum + key.length) & 255;
      }
      swap = sum & mask;
      if (++attempts > 11) swap = limit === 0 ? 0 : swap % limit;
    } while (swap > limit);
    [cards[limit], cards[swap]] = [cards[swap], cards[limit]];
  }

  let rotor = cards[1];
  let ratchet = cards[3];
  let avalanche = cards[5];
  let lastPlain = cards[7];
  let lastCipher = cards[sum];
  const plaintext = new Uint8Array(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) {
    ratchet = (ratchet + cards[rotor]) & 255;
    rotor = (rotor + 1) & 255;
    // In order: two of the indices can be equal.
    const held = cards[lastCipher];
    cards[lastCipher] = cards[ratchet];
    cards[ratchet] = cards[lastPlain];
    cards[lastPlain] = cards[rotor];
    cards[rotor] = held;
    avalanche = (avalanche + cards[held]) & 255;
    lastPlain =
      ciphertext[i] ^
      cards[(cards[ratchet] + cards[rotor]) & 255] ^
      cards[cards[(cards[lastPlain] + cards[lastCipher] + cards[avalanche]) & 255]];
    lastCipher = ciphertext[i];
    plaintext[i] = lastPlain;
  }
  return plaintext;
}
