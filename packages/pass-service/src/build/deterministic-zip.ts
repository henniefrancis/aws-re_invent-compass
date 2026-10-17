// A small zip writer whose output depends only on the entries: sorted paths, the DOS time
// 1980-01-01 00:00, mode 0644, raw deflate, CRC-32, no extra fields. The same entries always
// give the same bytes, so two builds of the same source tree are byte-identical.
// Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

/** 1980-01-01 00:00:00 in MS-DOS date and time fields. */
export const DOS_TIME = 0;
export const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** A regular file with mode 0644, in the high 16 bits of the external attributes. */
export const UNIX_FILE_MODE = 0o100644;

const UTF8_FLAG = 0x0800;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY_UNIX = (3 << 8) | 30;
const METHOD_DEFLATE = 8;

export function zipDeterministic(entries: readonly ZipEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  if (new Set(sorted.map((entry) => entry.path)).size !== sorted.length) {
    throw new RangeError('duplicate zip entry path');
  }
  const body: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of sorted) {
    const name = Buffer.from(entry.path, 'utf8');
    const data = Buffer.from(entry.data);
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    body.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION_MADE_BY_UNIX, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((UNIX_FILE_MODE << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);

    offset += local.length + name.length + compressed.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, directoryBytes, end]);
}
