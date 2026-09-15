/**
 * Password protection the way OrCAD writes it, for building protected designs in tests:
 * Sapphire II encryption with OrCAD's key schedule, and the stream wrapping around it.
 */

const MARKER = Buffer.from("FILE_FMT_SYENCRYPT01", "latin1");

/** Sapphire II encryption, transcribed from the published cipher. */
export function encryptSapphireII(plaintext: Uint8Array, key: Uint8Array): Buffer {
  const cards = [...Array(256).keys()];
  let rsum = 0;
  let keypos = 0;
  const keyrand = (limit: number): number => {
    let mask = 1;
    while (mask < limit) mask = (mask << 1) + 1;
    let retries = 0;
    let u: number;
    do {
      rsum = (cards[rsum] + key[keypos++]) % 256;
      if (keypos >= key.length) {
        keypos = 0;
        rsum = (rsum + key.length) % 256;
      }
      u = mask & rsum;
      // The published cipher returns 0 at limit 0 without drawing from the key; OrCAD draws.
      if (++retries > 11) u = limit === 0 ? 0 : u % limit;
    } while (u > limit);
    return u;
  };
  for (let i = 255; i >= 0; i--) {
    const j = keyrand(i);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  let rotor = cards[1];
  let ratchet = cards[3];
  let avalanche = cards[5];
  let lastPlain = cards[7];
  let lastCipher = cards[rsum];

  const out = Buffer.alloc(plaintext.length);
  plaintext.forEach((b, i) => {
    ratchet = (ratchet + cards[rotor]) % 256;
    rotor = (rotor + 1) % 256;
    const swaptemp = cards[lastCipher];
    cards[lastCipher] = cards[ratchet];
    cards[ratchet] = cards[lastPlain];
    cards[lastPlain] = cards[rotor];
    cards[rotor] = swaptemp;
    avalanche = (avalanche + cards[swaptemp]) % 256;
    lastCipher =
      b ^
      cards[(cards[ratchet] + cards[rotor]) % 256] ^
      cards[cards[(cards[lastPlain] + cards[lastCipher] + cards[avalanche]) % 256]];
    lastPlain = b;
    out[i] = lastCipher;
  });
  return out;
}

/** A stream as a protected design stores it; the Library keeps its first 22 bytes in clear. */
export function protectStream(path: string, data: Buffer, password: string): Buffer {
  const clear = path.split("/").pop() === "Library" ? 22 : 0;
  return Buffer.concat([
    data.subarray(0, clear),
    MARKER,
    encryptSapphireII(data.subarray(clear), Buffer.from(password, "latin1")),
  ]);
}
