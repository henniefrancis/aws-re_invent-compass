import { describe, expect, test } from 'vitest';
import { GitHubArchiveError } from '../../src/github/errors.js';
import {
  BLOCK_SIZE,
  ByteSource,
  MAX_META_BYTES,
  TarReader,
  parseHeader,
  parseNumber,
  parsePax,
  type ChunkReader,
  type TarEntry,
} from '../../src/github/tar-reader.js';
import {
  bytesOf,
  concat,
  longNameEntry,
  paxEntry,
  tarEntry,
  tarHeader,
  tarball,
} from './support.js';

/** A reader over fixed chunks. */
function chunksOf(...chunks: Uint8Array[]): ChunkReader {
  let index = 0;
  return {
    read: () =>
      Promise.resolve(
        index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
      ),
  };
}

/** Split bytes into chunks of `size`. */
function split(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    out.push(bytes.subarray(offset, offset + size));
  }
  return out;
}

function reader(bytes: Uint8Array, chunk = 100, max = Number.MAX_SAFE_INTEGER) {
  const source = new ByteSource(chunksOf(...split(bytes, chunk)), max);
  return { source, tar: new TarReader(source) };
}

async function entries(tar: TarReader): Promise<TarEntry[]> {
  const out: TarEntry[] = [];
  for (let entry = await tar.next(); entry !== undefined; entry = await tar.next()) {
    out.push(entry);
  }
  return out;
}

describe('ByteSource', () => {
  test('reads and skips across chunk boundaries, ignoring empty chunks', async () => {
    const source = new ByteSource(
      chunksOf(bytesOf('ab'), new Uint8Array(0), bytesOf('cde'), new Uint8Array(0), bytesOf('fgh')),
      100,
    );
    expect(await source.read(0)).toEqual(new Uint8Array(0));
    expect(new TextDecoder().decode(await source.read(4))).toBe('abcd');
    expect(await source.skip(2)).toBe(true);
    expect(new TextDecoder().decode(await source.read(2))).toBe('gh');
    expect(await source.read(1)).toBeUndefined();
    expect(await source.skip(1)).toBe(false);
    expect(await source.skip(0)).toBe(true);
    expect(source.capped).toBe(false);
  });

  test('skips through empty chunks and reports the end', async () => {
    const source = new ByteSource(chunksOf(new Uint8Array(0), bytesOf('xy')), 100);
    expect(await source.skip(2)).toBe(true);
    expect(await source.skip(1)).toBe(false);
  });

  test('stops and marks itself capped past the byte limit', async () => {
    const source = new ByteSource(chunksOf(bytesOf('abc'), bytesOf('def')), 4);
    expect(new TextDecoder().decode(await source.read(3))).toBe('abc');
    expect(await source.read(1)).toBeUndefined();
    expect(source.capped).toBe(true);
    expect(await source.read(1)).toBeUndefined();
  });
});

describe('parseNumber', () => {
  test('reads octal text, empty fields and base-256', () => {
    expect(parseNumber(bytesOf('0000644\0'))).toBe(0o644);
    expect(parseNumber(bytesOf(' 17 \0'))).toBe(15);
    expect(parseNumber(new Uint8Array(8))).toBe(0);
    expect(parseNumber(bytesOf('12x\0'))).toBeUndefined();
    expect(parseNumber(bytesOf('9\0'))).toBeUndefined();
    const big = new Uint8Array(12);
    big[0] = 0x80;
    big[10] = 0x01;
    big[11] = 0x02;
    expect(parseNumber(big)).toBe(258);
    const negative = new Uint8Array(12).fill(0xff);
    expect(parseNumber(negative)).toBeUndefined();
    const huge = new Uint8Array(12).fill(0x7f);
    huge[0] = 0xc0;
    expect(parseNumber(huge)).toBeUndefined();
  });
});

describe('parseHeader', () => {
  test('joins the ustar prefix, and ignores the prefix of a GNU or old header', () => {
    expect(parseHeader(tarHeader({ name: 'b.ts', prefix: 'a/very/long' }))).toEqual({
      type: '0',
      path: 'a/very/long/b.ts',
      size: 0,
    });
    expect(parseHeader(tarHeader({ name: 'b.ts', prefix: 'x', magic: 'gnu' })).path).toBe('b.ts');
    expect(parseHeader(tarHeader({ name: 'c', magic: 'none', type: '5' }))).toEqual({
      type: '5',
      path: 'c',
      size: 0,
    });
  });

  test('refuses a bad checksum or a bad size', () => {
    expect(() => parseHeader(tarHeader({ name: 'a', badChecksum: true }))).toThrow(
      GitHubArchiveError,
    );
    const badSize = new Uint8Array(12);
    badSize.set(bytesOf('zz'));
    expect(() => parseHeader(tarHeader({ name: 'a', sizeField: badSize }))).toThrow(
      GitHubArchiveError,
    );
  });
});

describe('parsePax', () => {
  const pax = (text: string) => bytesOf(text);

  test('reads path and size and ignores other keys', () => {
    expect(parsePax(pax('12 path=a/b\n11 size=42\n20 mtime=1700000000\n9 noeq__\n'))).toEqual({
      path: 'a/b',
      size: 42,
    });
    expect(parsePax(new Uint8Array(0))).toEqual({});
  });

  test.each([
    'garbage',
    'x path=a\n',
    '99 path=a\n',
    '10 path=ab',
    '12 size=4x2\n',
    '2 \n',
    '0 \n',
  ])('refuses the malformed record %j', (text) => {
    expect(() => parsePax(pax(text))).toThrow(GitHubArchiveError);
  });
});

describe('TarReader', () => {
  test('reads files, folders, links and others, with PAX and GNU long names, skipping g and K', async () => {
    const longPath = `${'deep/'.repeat(30)}file.ts`;
    const gnuPath = `${'gnu/'.repeat(30)}file.py`;
    const { tar } = reader(
      tarball([
        paxEntry({ comment: 'abc' }, 'g'),
        tarEntry('top/', '', { type: '5' }),
        tarEntry('top/a.ts', 'hello'),
        paxEntry({ path: longPath, size: '3' }),
        tarEntry('ignored-name', 'abc', { size: 3 }),
        longNameEntry(gnuPath),
        tarEntry('truncated-name', 'x'),
        tarEntry('././@LongLink', 'target\0', { type: 'K', magic: 'gnu' }),
        tarEntry('top/link', '', { type: '2' }),
        tarEntry('top/hard', '', { type: '1' }),
        tarEntry('top/fifo', '', { type: '6' }),
        tarEntry('top/old', 'z', { type: '\0' }),
        tarEntry('top/contig', 'z', { type: '7' }),
      ]),
      77,
    );
    expect(await tar.next()).toEqual({ kind: 'directory', path: 'top/', size: 0 });
    expect(await tar.next()).toEqual({ kind: 'file', path: 'top/a.ts', size: 5 });
    expect(new TextDecoder().decode(await tar.readBody())).toBe('hello');
    expect(await entries(tar)).toEqual([
      { kind: 'file', path: longPath, size: 3 },
      { kind: 'file', path: gnuPath, size: 1 },
      { kind: 'link', path: 'top/link', size: 0 },
      { kind: 'link', path: 'top/hard', size: 0 },
      { kind: 'other', path: 'top/fifo', size: 0 },
      { kind: 'file', path: 'top/old', size: 1 },
      { kind: 'file', path: 'top/contig', size: 1 },
    ]);
    expect(tar.unexpectedEnd).toBe(false);
  });

  test('a PAX header with neither path nor size keeps the header values', async () => {
    const { tar } = reader(tarball([paxEntry({ mtime: '1' }), tarEntry('a.ts', 'ab')]));
    expect(await tar.next()).toEqual({ kind: 'file', path: 'a.ts', size: 2 });
  });

  test('an archive without end blocks simply ends', async () => {
    const { tar } = reader(tarEntry('a.ts', 'ab'));
    expect(await entries(tar)).toHaveLength(1);
    expect(tar.unexpectedEnd).toBe(false);
  });

  test('a metadata body over 64 KiB is refused', async () => {
    const { tar } = reader(tarball([tarEntry('L', 'x'.repeat(MAX_META_BYTES + 1), { type: 'L' })]));
    await expect(tar.next()).rejects.toBeInstanceOf(GitHubArchiveError);
  });

  test.each([
    ['inside a PAX body', paxEntry({ path: 'a'.repeat(600) }).subarray(0, BLOCK_SIZE + 100)],
    ['inside the padding of a PAX body', paxEntry({ path: 'a' }).subarray(0, BLOCK_SIZE + 20)],
    ['inside a global header', paxEntry({ comment: 'c' }, 'g').subarray(0, BLOCK_SIZE + 5)],
  ])('an archive that ends %s is an unexpected end', async (_label, bytes) => {
    const { tar } = reader(bytes);
    expect(await tar.next()).toBeUndefined();
    expect(tar.unexpectedEnd).toBe(true);
  });

  test('an archive that ends inside a skipped or a read body is an unexpected end', async () => {
    const cut = tarEntry('a.ts', 'x'.repeat(1000)).subarray(0, BLOCK_SIZE + 10);
    const skipped = reader(cut);
    expect(await skipped.tar.next()).toMatchObject({ path: 'a.ts' });
    expect(await skipped.tar.next()).toBeUndefined();
    expect(skipped.tar.unexpectedEnd).toBe(true);

    const read = reader(cut);
    await read.tar.next();
    expect(await read.tar.readBody()).toBeUndefined();
    expect(read.tar.unexpectedEnd).toBe(true);
    expect(await read.tar.next()).toBeUndefined();
  });

  test('a cap on the source looks like an end, and the source says it was capped', async () => {
    const { source, tar } = reader(
      tarball([tarEntry('a.ts', 'x'.repeat(5000)), tarEntry('b.ts', 'y')]),
      512,
      2048,
    );
    expect(await tar.next()).toMatchObject({ path: 'a.ts' });
    expect(await tar.next()).toBeUndefined();
    expect(source.capped).toBe(true);
  });

  test('every header is checksummed', async () => {
    const { tar } = reader(
      concat([tarHeader({ name: 'a', badChecksum: true }), new Uint8Array(1024)]),
    );
    await expect(tar.next()).rejects.toBeInstanceOf(GitHubArchiveError);
  });
});
