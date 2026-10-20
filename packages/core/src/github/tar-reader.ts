// A small streaming tar reader for repository archives (compass-power task 45.1).
//
// It reads 512-byte headers (POSIX ustar with the prefix field, PAX `x` headers carrying `path`
// and `size`, GNU `L` long names), skips PAX `g` global headers and GNU `K` long link names, and
// reports every other entry as a file, a directory, a link or `other`. It never buffers more
// than one header, one metadata body (at most 64 KiB) or the one body the caller asks for, and
// skips every other body as it streams past. Nothing is written to disk.
//
// The bytes come from a `ByteSource`, which stops at a fixed number of unpacked bytes and marks
// itself `capped`. An archive that ends inside an entry sets `unexpectedEnd`; a header with a bad
// checksum or a malformed PAX record throws GitHubArchiveError. Internal to the GitHub module.

import { GitHubArchiveError } from './errors.js';

/** The tar block size. */
export const BLOCK_SIZE = 512;
/** The largest PAX or GNU long-name body read into memory. */
export const MAX_META_BYTES = 64 * 1024;

/** The part of a stream reader the source uses. */
export interface ChunkReader {
  read(): Promise<{ done: false; value: Uint8Array } | { done: true; value?: undefined }>;
}

/** Bytes pulled from a reader, counted, and stopped after `maxBytes`. */
export class ByteSource {
  /** True when more than `maxBytes` arrived; the source then reports its end. */
  capped = false;
  private total = 0;
  private ended = false;
  private readonly chunks: Uint8Array[] = [];
  private head = 0;
  private buffered = 0;

  constructor(
    private readonly reader: ChunkReader,
    private readonly maxBytes: number,
  ) {}

  /** Pull one chunk. False at the end of the stream or past the cap. */
  private async fill(): Promise<boolean> {
    if (this.ended) {
      return false;
    }
    const chunk = await this.reader.read();
    if (chunk.done) {
      this.ended = true;
      return false;
    }
    this.total += chunk.value.byteLength;
    if (this.total > this.maxBytes) {
      this.capped = true;
      this.ended = true;
      return false;
    }
    if (chunk.value.byteLength > 0) {
      this.chunks.push(chunk.value);
      this.buffered += chunk.value.byteLength;
    }
    return true;
  }

  /** Move past `count` buffered bytes of the first chunk. */
  private advance(count: number): void {
    this.head += count;
    this.buffered -= count;
    if (this.head === this.chunks[0]!.byteLength) {
      this.chunks.shift();
      this.head = 0;
    }
  }

  /** Exactly `count` bytes, or undefined when the stream ends first. */
  async read(count: number): Promise<Uint8Array | undefined> {
    while (this.buffered < count) {
      if (!(await this.fill())) {
        return undefined;
      }
    }
    const out = new Uint8Array(count);
    let filled = 0;
    while (filled < count) {
      const chunk = this.chunks[0]!;
      const take = Math.min(chunk.byteLength - this.head, count - filled);
      out.set(chunk.subarray(this.head, this.head + take), filled);
      filled += take;
      this.advance(take);
    }
    return out;
  }

  /** Skip `count` bytes without keeping them. False when the stream ends first. */
  async skip(count: number): Promise<boolean> {
    let remaining = count;
    while (remaining > 0) {
      if (this.buffered === 0 && !(await this.fill())) {
        return false;
      }
      if (this.buffered > 0) {
        const take = Math.min(this.chunks[0]!.byteLength - this.head, remaining);
        this.advance(take);
        remaining -= take;
      }
    }
    return true;
  }
}

/** What a tar entry is. */
export type TarEntryKind = 'file' | 'directory' | 'link' | 'other';

/** One entry header. `path` is as stored in the archive, not yet checked. */
export interface TarEntry {
  kind: TarEntryKind;
  path: string;
  size: number;
}

/** A parsed 512-byte header. */
export interface TarHeader {
  type: string;
  path: string;
  size: number;
}

const decoder = new TextDecoder('utf-8');

/** The text of a NUL-terminated field. */
function cString(field: Uint8Array): string {
  const end = field.indexOf(0);
  return decoder.decode(end === -1 ? field : field.subarray(0, end));
}

/** A numeric header field: octal text, or base-256 when the high bit is set. Undefined if invalid. */
export function parseNumber(field: Uint8Array): number | undefined {
  const first = field[0]!;
  if ((first & 0x80) !== 0) {
    if (first === 0xff) {
      return undefined;
    }
    let value = first & 0x7f;
    for (const byte of field.subarray(1)) {
      value = value * 256 + byte;
    }
    return Number.isSafeInteger(value) ? value : undefined;
  }
  const text = cString(field).trim();
  if (text === '') {
    return 0;
  }
  return /^[0-7]{1,16}$/.test(text) ? parseInt(text, 8) : undefined;
}

/** True when every byte of the block is zero (the end-of-archive marker). */
function isZeroBlock(block: Uint8Array): boolean {
  return block.every((byte) => byte === 0);
}

/** Parse one header block, checking its checksum. Throws GitHubArchiveError when it is invalid. */
export function parseHeader(block: Uint8Array): TarHeader {
  let sum = 0;
  for (let index = 0; index < BLOCK_SIZE; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : block[index]!;
  }
  const size = parseNumber(block.subarray(124, 136));
  if (parseNumber(block.subarray(148, 156)) !== sum || size === undefined) {
    throw new GitHubArchiveError();
  }
  const name = cString(block.subarray(0, 100));
  const isPosix = cString(block.subarray(257, 263)) === 'ustar';
  const prefix = isPosix ? cString(block.subarray(345, 500)) : '';
  return {
    type: String.fromCharCode(block[156]!),
    path: prefix === '' ? name : `${prefix}/${name}`,
    size,
  };
}

/** The `path` and `size` of a PAX extended header body. Throws GitHubArchiveError when malformed. */
export function parsePax(body: Uint8Array): { path?: string; size?: number } {
  const result: { path?: string; size?: number } = {};
  let position = 0;
  while (position < body.length) {
    const space = body.indexOf(0x20, position);
    const lengthText = space === -1 ? '' : decoder.decode(body.subarray(position, space));
    const length = /^\d{1,8}$/.test(lengthText) ? Number(lengthText) : 0;
    const end = position + length;
    if (length === 0 || space + 1 >= end || end > body.length || body[end - 1] !== 0x0a) {
      throw new GitHubArchiveError();
    }
    const record = decoder.decode(body.subarray(space + 1, end - 1));
    const equals = record.indexOf('=');
    const key = record.slice(0, equals);
    const value = record.slice(equals + 1);
    if (equals > 0 && key === 'path') {
      result.path = value;
    } else if (equals > 0 && key === 'size') {
      if (!/^\d{1,15}$/.test(value)) {
        throw new GitHubArchiveError();
      }
      result.size = Number(value);
    }
    position = end;
  }
  return result;
}

/** The kind of an entry from its type flag. */
function kindOf(type: string): TarEntryKind {
  switch (type) {
    case '0':
    case '\0':
    case '7':
      return 'file';
    case '5':
      return 'directory';
    case '1':
    case '2':
      return 'link';
    default:
      return 'other';
  }
}

/** The bytes of padding after a body of `size` bytes. */
function paddingOf(size: number): number {
  return (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE;
}

/** Reads entries one at a time from a ByteSource. */
export class TarReader {
  /** True when the archive ended inside a header body or an entry. */
  unexpectedEnd = false;
  private bodyLeft = 0;
  private paddingLeft = 0;

  constructor(private readonly source: ByteSource) {}

  /** Skip whatever is left of the current entry. False when the archive ends first. */
  private async skipRest(): Promise<boolean> {
    const count = this.bodyLeft + this.paddingLeft;
    this.bodyLeft = 0;
    this.paddingLeft = 0;
    if (!(await this.source.skip(count))) {
      this.unexpectedEnd = true;
      return false;
    }
    return true;
  }

  /** Read a metadata body (PAX or GNU long name) of `size` bytes, with its padding. */
  private async readMeta(size: number): Promise<Uint8Array | undefined> {
    if (size > MAX_META_BYTES) {
      throw new GitHubArchiveError();
    }
    const body = await this.source.read(size);
    if (body === undefined || !(await this.source.skip(paddingOf(size)))) {
      this.unexpectedEnd = true;
      return undefined;
    }
    return body;
  }

  /** The next entry, or undefined at the end of the archive. */
  async next(): Promise<TarEntry | undefined> {
    if (!(await this.skipRest())) {
      return undefined;
    }
    let paxPath: string | undefined;
    let paxSize: number | undefined;
    let longName: string | undefined;
    for (;;) {
      const block = await this.source.read(BLOCK_SIZE);
      if (block === undefined || isZeroBlock(block)) {
        return undefined;
      }
      const header = parseHeader(block);
      if (header.type === 'x' || header.type === 'L') {
        const body = await this.readMeta(header.size);
        if (body === undefined) {
          return undefined;
        }
        if (header.type === 'L') {
          longName = cString(body);
        } else {
          const pax = parsePax(body);
          paxPath = pax.path ?? paxPath;
          paxSize = pax.size ?? paxSize;
        }
        continue;
      }
      if (header.type === 'g' || header.type === 'K') {
        this.bodyLeft = header.size;
        this.paddingLeft = paddingOf(header.size);
        if (!(await this.skipRest())) {
          return undefined;
        }
        continue;
      }
      const kind = kindOf(header.type);
      // Only a file has a body; a size on any other entry is skipped as it streams past.
      const size = paxSize ?? header.size;
      this.bodyLeft = size;
      this.paddingLeft = paddingOf(size);
      return { kind, path: paxPath ?? longName ?? header.path, size };
    }
  }

  /** The whole body of the current entry. Undefined when the archive ends first. */
  async readBody(): Promise<Uint8Array | undefined> {
    const body = await this.source.read(this.bodyLeft);
    if (body === undefined) {
      this.unexpectedEnd = true;
      this.bodyLeft = 0;
      this.paddingLeft = 0;
      return undefined;
    }
    this.bodyLeft = 0;
    return body;
  }
}
