// Test helpers for the GitHub module: a recording fake fetch, fake responses, and a tar and
// tar.gz builder. Nothing here reaches the network.

import { gzipSync } from 'node:zlib';
import type { GitHubFetch, GitHubFetchInit, GitHubResponseLike } from '../../src/github/http.js';

/** One recorded fetch call. */
export interface FetchCall {
  url: string;
  init: GitHubFetchInit;
}

/** A fake fetch that records each call and answers with `answer`. */
export function fakeFetch(
  answer: (
    url: string,
    init: GitHubFetchInit,
    index: number,
  ) => GitHubResponseLike | Promise<GitHubResponseLike>,
): { fetch: GitHubFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch: GitHubFetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(answer(url, init, calls.length - 1));
  };
  return { fetch, calls };
}

/** Headers from a plain record, looked up without regard to case. */
function headersOf(headers: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower.get(name.toLowerCase()) ?? null };
}

/** A response with a text body (JSON when `body` is not a string) and no stream. */
export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): GitHubResponseLike {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    headers: headersOf(headers),
    body: null,
    text: () => Promise.resolve(text),
  };
}

/** A response whose body streams `bytes` in chunks of `chunkSize`. Records how much was pulled and whether it was cancelled. */
export function streamResponse(
  status: number,
  bytes: Uint8Array,
  headers: Record<string, string> = {},
  chunkSize = 4096,
): GitHubResponseLike & { cancelled: () => boolean; pulled: () => number } {
  let offset = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    status,
    headers: headersOf(headers),
    body: stream,
    text: () => Promise.resolve(''),
    cancelled: () => cancelled,
    pulled: () => Math.min(offset, bytes.length),
  };
}

/** A response whose body errors on the first read. */
export function brokenStreamResponse(status: number): GitHubResponseLike {
  return {
    status,
    headers: headersOf({}),
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    }),
    text: () => Promise.resolve(''),
  };
}

const encoder = new TextEncoder();

/** Bytes of a string or a byte array. */
export function bytesOf(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data;
}

function writeText(block: Uint8Array, offset: number, length: number, text: string): void {
  const bytes = encoder.encode(text);
  block.set(bytes.subarray(0, length), offset);
}

function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

/** Options for one tar header. */
export interface HeaderOptions {
  name: string;
  size?: number;
  type?: string;
  prefix?: string;
  /** 'posix' (ustar\0 00), 'gnu' (ustar  \0) or 'none'. */
  magic?: 'posix' | 'gnu' | 'none';
  /** A raw 12-byte size field, for base-256 tests. */
  sizeField?: Uint8Array;
  /** Break the checksum. */
  badChecksum?: boolean;
}

/** One 512-byte tar header with a correct checksum. */
export function tarHeader(options: HeaderOptions): Uint8Array {
  const block = new Uint8Array(512);
  writeText(block, 0, 100, options.name);
  writeText(block, 100, 8, octal(0o644, 8));
  writeText(block, 108, 8, octal(0, 8));
  writeText(block, 116, 8, octal(0, 8));
  if (options.sizeField === undefined) {
    writeText(block, 124, 12, octal(options.size ?? 0, 12));
  } else {
    block.set(options.sizeField, 124);
  }
  writeText(block, 136, 12, octal(0, 12));
  block[156] = (options.type ?? '0').charCodeAt(0);
  const magic = options.magic ?? 'posix';
  if (magic === 'posix') {
    writeText(block, 257, 6, 'ustar\0');
    writeText(block, 263, 2, '00');
  } else if (magic === 'gnu') {
    writeText(block, 257, 8, 'ustar  \0');
  }
  writeText(block, 345, 155, options.prefix ?? '');
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) {
    sum += byte;
  }
  writeText(block, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  if (options.badChecksum === true) {
    block[148] = '7'.charCodeAt(0);
  }
  return block;
}

/** Padding up to the next 512-byte boundary. */
function padding(size: number): Uint8Array {
  return new Uint8Array((512 - (size % 512)) % 512);
}

/** A header plus its body and padding. */
export function tarEntry(
  name: string,
  data: string | Uint8Array = '',
  options: Partial<HeaderOptions> = {},
): Uint8Array {
  const body = bytesOf(data);
  return concat([tarHeader({ name, size: body.length, ...options }), body, padding(body.length)]);
}

/** A PAX extended header (`x`, or `g` for global) with the given records. */
export function paxEntry(records: Record<string, string>, type: 'x' | 'g' = 'x'): Uint8Array {
  let text = '';
  for (const [key, value] of Object.entries(records)) {
    const tail = ` ${key}=${value}\n`;
    let length = tail.length + 1;
    while (`${String(length)}${tail}`.length !== length) {
      length += 1;
    }
    text += `${String(length)}${tail}`;
  }
  return tarEntry('PaxHeader', text, { type });
}

/** A GNU long-name entry for the next header. */
export function longNameEntry(name: string): Uint8Array {
  return tarEntry('././@LongLink', `${name}\0`, { type: 'L', magic: 'gnu' });
}

/** Join byte arrays. */
export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A whole tar: the entries and two zero blocks. */
export function tarball(entries: readonly Uint8Array[]): Uint8Array {
  return concat([...entries, new Uint8Array(1024)]);
}

/** gzip with node:zlib. */
export function gzip(data: Uint8Array): Uint8Array {
  return new Uint8Array(gzipSync(data));
}

/** The top folder GitHub puts every entry under. */
export const TOP = 'octo-hello-abc1234';

/** A GitHub-shaped archive: a global PAX header with the commit, the top folder, then entries. */
export function githubTarball(entries: readonly Uint8Array[]): Uint8Array {
  return tarball([
    paxEntry({ comment: 'abc1234abc1234abc1234abc1234abc1234abc12' }, 'g'),
    tarEntry(`${TOP}/`, '', { type: '5' }),
    ...entries,
  ]);
}

/** A token that must never appear in an error or a log. */
export const SECRET_ACCESS = 'ghu_SECRETaccessTOKEN0123456789abcdef';
export const SECRET_REFRESH = 'ghr_SECRETrefreshTOKEN0123456789abcdef';
export const SECRET_DEVICE = 'devicecodeSECRET0123456789abcdef01234567';

/** Every string an error exposes, for a no-secret check. */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return `${error.name} ${error.message} ${String(error.stack)} ${JSON.stringify(error)} ${String(
    (error as { cause?: unknown }).cause,
  )}`;
}
