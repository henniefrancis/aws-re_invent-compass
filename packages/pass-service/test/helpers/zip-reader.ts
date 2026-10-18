// A minimal zip reader over node:zlib for the pass, bundle and Lambda zip checks. It reads
// the central directory, so it works for archives written without data descriptors.
import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  path: string;
  data: Buffer;
  /** Fields of the central directory record, for the deterministic zip checks. */
  dosTime: number;
  dosDate: number;
  externalAttributes: number;
  extraLength: number;
  crcOk: boolean;
}

export function readZip(zip: Uint8Array): ZipEntry[] {
  const buffer = Buffer.from(zip);
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) {
    end -= 1;
  }
  if (end < 0) {
    throw new Error('not a zip file');
  }
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('bad central directory');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const dosTime = buffer.readUInt16LE(offset + 12);
    const dosDate = buffer.readUInt16LE(offset + 14);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const path = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    entries.push({
      path,
      data,
      dosTime,
      dosDate,
      externalAttributes,
      extraLength,
      crcOk: crc32(data) === crc,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function zipMap(zip: Uint8Array): Map<string, Buffer> {
  return new Map(readZip(zip).map((entry) => [entry.path, entry.data]));
}
