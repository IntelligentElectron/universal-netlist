import { describe, expect, it } from "vitest";
import { decryptSapphireII } from "./sapphire.js";
import { encryptSapphireII } from "../../../../test/helpers/orcad-protect.js";
import vectors from "./sapphire-vectors.json" with { type: "json" };

describe("decryptSapphireII", () => {
  it.each(vectors.map((vector, index) => [index, vector] as const))(
    "decrypts known answer %i",
    (_, vector) => {
      const plain = decryptSapphireII(
        Buffer.from(vector.cipher, "hex"),
        Buffer.from(vector.key, "hex")
      );
      expect(Buffer.from(plain).toString("hex")).toBe(vector.plain);
    }
  );

  it("inverts encryption for every key length and past one cycle of the cards", () => {
    const plaintext = Buffer.from(Array.from({ length: 700 }, (_, i) => (i * 37 + 11) % 256));
    for (const length of [1, 2, 13, 128, 255]) {
      const key = Buffer.from(Array.from({ length }, (_, i) => 0x20 + ((i * 7) % 95)));
      const ciphertext = encryptSapphireII(plaintext, key);
      expect(ciphertext.equals(plaintext)).toBe(false);
      expect(Buffer.from(decryptSapphireII(ciphertext, key))).toEqual(plaintext);
    }
  });

  it("takes keys of 1 to 255 bytes", () => {
    expect(decryptSapphireII(new Uint8Array(), new Uint8Array(1))).toHaveLength(0);
    for (const length of [0, 256]) {
      expect(() => decryptSapphireII(new Uint8Array(), new Uint8Array(length))).toThrow(
        "1 to 255 bytes"
      );
    }
  });
});
