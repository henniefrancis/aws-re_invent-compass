import { createHash } from 'node:crypto';
import type { Random } from '../../src/seams.js';

/** A deterministic Random: bytes come from SHA-256 over the seed and a counter. */
export function createSeededRandom(seed: string): Random {
  let counter = 0;
  function bytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      counter += 1;
      const block = createHash('sha256').update(`${seed}:${counter}`).digest();
      const take = Math.min(block.length, length - filled);
      out.set(block.subarray(0, take), filled);
      filled += take;
    }
    return out;
  }
  return {
    bytes,
    uuid() {
      const b = bytes(16);
      b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
      b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
      const hex = Buffer.from(b).toString('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  };
}
