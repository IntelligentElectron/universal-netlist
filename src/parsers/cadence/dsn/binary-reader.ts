/**
 * BinaryReader - Low-level binary data reading utility
 *
 * Port of DataStream.cpp from OpenOrCadParser.
 * Wraps a Buffer with position tracking and typed read methods.
 * All integers are little-endian. Strings are ASCII (1 byte/char).
 */

export class BinaryReader {
  private buf: Buffer;
  private pos: number;

  constructor(buffer: Buffer, offset = 0) {
    this.buf = buffer;
    this.pos = offset;
  }

  tell(): number {
    return this.pos;
  }

  remaining(): number {
    return this.buf.length - this.pos;
  }

  isEof(): boolean {
    return this.pos >= this.buf.length;
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.buf.length) {
      throw new Error(`Seek out of bounds: ${offset} (size: ${this.buf.length})`);
    }
    this.pos = offset;
  }

  skip(bytes: number): void {
    this.seek(this.pos + bytes);
  }

  peek(n: number): Buffer {
    this.ensureAvailable(n);
    return this.buf.subarray(this.pos, this.pos + n);
  }

  readUint8(): number {
    this.ensureAvailable(1);
    const val = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return val;
  }

  readInt8(): number {
    this.ensureAvailable(1);
    const val = this.buf.readInt8(this.pos);
    this.pos += 1;
    return val;
  }

  readUint16(): number {
    this.ensureAvailable(2);
    const val = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return val;
  }

  readInt16(): number {
    this.ensureAvailable(2);
    const val = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return val;
  }

  readUint32(): number {
    this.ensureAvailable(4);
    const val = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return val;
  }

  readInt32(): number {
    this.ensureAvailable(4);
    const val = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return val;
  }

  readBytes(n: number): Buffer {
    this.ensureAvailable(n);
    const data = Buffer.from(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return data;
  }

  /**
   * Read a null-terminated ASCII string (no length prefix).
   * Safety limit of 3500 chars (matching C++ reference).
   */
  readStringZeroTerm(): string {
    const start = this.pos;
    const limit = Math.min(this.buf.length, start + 3500);
    while (this.pos < limit) {
      if (this.buf[this.pos] === 0) {
        const str = this.buf.toString("ascii", start, this.pos);
        this.pos++; // skip null terminator
        return str;
      }
      this.pos++;
    }
    throw new Error(`Null terminator not found within 3500 chars at offset ${start}`);
  }

  /**
   * Read a length-prefixed string (uint16 length, no null terminator).
   * Safety limit of 400 chars (matching C++ reference).
   */
  readStringLenTerm(): string {
    const len = this.readUint16();
    if (len > 400) {
      throw new Error(`String length ${len} exceeds limit of 400 at offset ${this.pos - 2}`);
    }
    this.ensureAvailable(len);
    const str = this.buf.toString("ascii", this.pos, this.pos + len);
    this.pos += len;
    return str;
  }

  /**
   * Read a length-prefixed, null-terminated ASCII string.
   * Format: uint16 length + chars + null terminator.
   * The length should match the string length (not counting the null).
   */
  readStringLenZeroTerm(): string {
    const len = this.readUint16();
    if (len > 400) {
      throw new Error(`String length ${len} exceeds limit of 400 at offset ${this.pos - 2}`);
    }
    if (len === 0) {
      // Empty string: just a null terminator
      const b = this.readUint8();
      if (b !== 0) {
        throw new Error(`Expected null terminator for empty string at offset ${this.pos - 1}`);
      }
      return "";
    }
    this.ensureAvailable(len + 1); // chars + null
    const str = this.buf.toString("ascii", this.pos, this.pos + len);
    this.pos += len;
    const terminator = this.buf[this.pos];
    if (terminator !== 0) {
      throw new Error(
        `Expected null terminator after string of length ${len} at offset ${this.pos}`
      );
    }
    this.pos++; // skip null
    return str;
  }

  /**
   * Verify the next bytes match the expected data.
   * Consumes the bytes if they match, throws if they don't.
   */
  assumeData(expected: number[]): void {
    this.ensureAvailable(expected.length);
    for (let i = 0; i < expected.length; i++) {
      const actual = this.buf[this.pos + i];
      if (actual !== expected[i]) {
        throw new Error(
          `Data mismatch at offset ${this.pos + i}: expected 0x${expected[i].toString(16).padStart(2, "0")}, got 0x${actual.toString(16).padStart(2, "0")}`
        );
      }
    }
    this.pos += expected.length;
  }

  private ensureAvailable(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new Error(
        `Read past end of buffer: need ${n} bytes at offset ${this.pos}, buffer size ${this.buf.length}`
      );
    }
  }
}
