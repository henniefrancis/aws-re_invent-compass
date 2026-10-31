// The repository archive reader (compass-power task 45.1, Requirement P2.9).
//
// GET https://api.github.com/repos/{owner}/{repo}/tarball with `redirect: 'manual'` (GitHub
// "REST API endpoints for repository contents", download a repository archive (tar), checked 20
// October 2026). Only a 302 whose Location is on https://codeload.github.com/ is accepted, and
// that URL is fetched WITHOUT the Authorization header. The body streams through gunzip into the
// in-house tar reader; nothing is written to disk and the archive is never buffered whole. The
// download stops, and the summary says `truncated`, at 100 MB compressed or 500 MB unpacked.
//
// The scanner's rules apply to every entry: the single top folder GitHub adds is dropped, a path
// with `..` or an absolute path is refused, `isExcludedDirectory` is checked on every directory
// part, links are counted as `symlink`, only supported files are decoded (other regular files
// yield their name only), the file size limit, the binary probe, `maxFiles`, `maxEntries` and
// `maxDepth` hold, and `productionMarkerFor` sets the production marker. A refused path, a
// device or a FIFO counts as `unsupportedType`.

import { finished } from 'node:stream/promises';
import { createGunzip, type Gunzip } from 'node:zlib';
import { isExcludedDirectory, isSupportedFile } from '../scanner/file-filter.js';
import type { SourceFile } from '../scanner/source-file.js';
import { DEFAULT_WALK_LIMITS, productionMarkerFor } from '../scanner/walker.js';
import type { WalkLimits, WalkSummary } from '../scanner/walker.js';
import { isRepositoryFullName, GITHUB_API_ORIGIN } from './client.js';
import {
  GitHubArchiveError,
  GitHubNotConnectedError,
  GitHubRepositoryNotFoundError,
  GitHubRequestError,
} from './errors.js';
import {
  USER_AGENT,
  apiHeaders,
  discardBody,
  failureFor,
  sendGitHubRequest,
  type GitHubFetch,
  type GitHubResponseLike,
} from './http.js';
import { ByteSource, TarReader, type ChunkReader } from './tar-reader.js';
import type { BodyReaderLike } from '../api/capped-body.js';

/** The archive limits: the walk limits plus the download caps. */
export interface ArchiveLimits extends WalkLimits {
  /** The most compressed bytes downloaded. */
  maxCompressedBytes: number;
  /** The most bytes unpacked from the gzip stream. */
  maxUnpackedBytes: number;
}

/** The default limits: the walker's, 100 MB compressed and 500 MB unpacked. */
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  ...DEFAULT_WALK_LIMITS,
  maxCompressedBytes: 100 * 1024 * 1024,
  maxUnpackedBytes: 500 * 1024 * 1024,
};

/** The only origin an archive redirect may point at. */
export const CODELOAD_PREFIX = 'https://codeload.github.com/';

/** What `readRepositoryArchive` needs. */
export interface ReadRepositoryArchiveOptions {
  /** `owner/name`. */
  fullName: string;
  accessToken: string;
  fetch: GitHubFetch;
  limits?: Partial<ArchiveLimits>;
  signal?: AbortSignal;
}

function emptySummary(): WalkSummary {
  return {
    filesRead: 0,
    skipped: {
      excludedDirectory: 0,
      gitignored: 0,
      tooLarge: 0,
      binary: 0,
      symlink: 0,
      unsupportedType: 0,
    },
    truncated: false,
    productionMarker: false,
  };
}

/** The parts of an archive path, or undefined when it is absolute or climbs with `..`. */
export function splitArchivePath(path: string): string[] | undefined {
  if (/^(?:[\\/]|[A-Za-z]:)/.test(path)) {
    return undefined;
  }
  const parts = path.split('/').filter((part) => part !== '' && part !== '.');
  return parts.includes('..') ? undefined : parts;
}

/** Ask the API for the archive and return the codeload URL it redirects to. */
async function archiveLocation(options: ReadRepositoryArchiveOptions): Promise<string> {
  if (!isRepositoryFullName(options.fullName)) {
    throw new GitHubRepositoryNotFoundError();
  }
  const [owner = '', name = ''] = options.fullName.split('/');
  const response = await sendGitHubRequest(
    options.fetch,
    `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tarball`,
    {
      method: 'GET',
      headers: apiHeaders(options.accessToken),
      redirect: 'manual',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  discardBody(response);
  if (response.status === 404) {
    throw new GitHubRepositoryNotFoundError();
  }
  if (response.status !== 302) {
    throw failureFor(response, Date.now);
  }
  // The prefix pins the host to codeload.github.com; the request itself is checked again.
  const location = response.headers.get('location');
  if (location === null || !location.startsWith(CODELOAD_PREFIX)) {
    throw new GitHubArchiveError();
  }
  return location;
}

/** Cancel a reader, ignoring a failure (a reader of a stream that already failed rejects). */
function release(reader: { cancel(): Promise<void> }): Promise<void> {
  return reader.cancel().catch(() => undefined);
}

/** Compressed bytes fed to gunzip at a time, so one feed unpacks to about 1 MB at most. */
export const FEED_BYTES = 1024;

/**
 * Write one slice to gunzip and wait until it has been processed. A failure is reported by the
 * end of the stream this is raced with (zlib does not always call back a failed write).
 */
function feed(gunzip: Gunzip, slice: Uint8Array): Promise<void> {
  return new Promise((resolve) => {
    gunzip.write(slice, () => {
      resolve();
    });
  });
}

/**
 * Unpack the download lazily: one small slice of compressed bytes is fed only when the reader
 * wants more, so neither side is ever buffered whole. Compressed bytes are counted as they
 * stream; past `maxBytes` the download stops and `state.capped` is set.
 */
async function* inflate(
  download: BodyReaderLike,
  maxBytes: number,
  state: { capped: boolean },
): AsyncGenerator<Uint8Array, void> {
  const gunzip = createGunzip();
  const output: Uint8Array[] = [];
  gunzip.on('data', (chunk: Uint8Array) => {
    output.push(chunk);
  });
  const ended = finished(gunzip);
  ended.catch(() => undefined);
  let total = 0;
  try {
    for (;;) {
      const chunk = await download.read();
      if (chunk.done) {
        break;
      }
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        state.capped = true;
        return;
      }
      for (let offset = 0; offset < chunk.value.byteLength; offset += FEED_BYTES) {
        // zlib never calls back a write it failed on, so the end of the stream is raced too.
        await Promise.race([
          feed(gunzip, chunk.value.subarray(offset, offset + FEED_BYTES)),
          ended,
        ]);
        yield* output.splice(0);
      }
    }
    gunzip.end();
    await ended;
    yield* output.splice(0);
  } finally {
    gunzip.destroy();
  }
}

/**
 * Read a repository archive in memory and yield each file as the scanner sees it. The return
 * value is the summary, with the walker's skip reasons. Throws GitHubRepositoryNotFoundError,
 * GitHubNotConnectedError, GitHubRateLimitedError, GitHubRequestError, GitHubNetworkError or
 * GitHubArchiveError; none carries the token, the name or a path.
 */
export async function* readRepositoryArchive(
  options: ReadRepositoryArchiveOptions,
): AsyncGenerator<SourceFile, WalkSummary> {
  const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...options.limits };
  const summary = emptySummary();
  const location = await archiveLocation(options);
  const response: GitHubResponseLike = await sendGitHubRequest(options.fetch, location, {
    method: 'GET',
    headers: { 'user-agent': USER_AGENT },
    redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (response.status === 401) {
    discardBody(response);
    throw new GitHubNotConnectedError();
  }
  if (response.status !== 200 || response.body === null) {
    discardBody(response);
    throw new GitHubRequestError(response.status);
  }
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limits.maxCompressedBytes) {
    discardBody(response);
    summary.truncated = true;
    return summary;
  }

  const compressed = { capped: false };
  const download = response.body.getReader();
  const inflater = inflate(download, limits.maxCompressedBytes, compressed);
  const chunks: ChunkReader = {
    async read() {
      try {
        const next = await inflater.next();
        return next.done === true ? { done: true } : { done: false, value: next.value };
      } catch {
        // A broken download or a corrupt gzip stream.
        throw new GitHubArchiveError();
      }
    },
  };
  const source = new ByteSource(chunks, limits.maxUnpackedBytes);
  const tar = new TarReader(source);
  const decoder = new TextDecoder('utf-8');
  const countedExclusions = new Set<string>();
  let entries = 0;

  try {
    for (;;) {
      const entry = await tar.next();
      if (entry === undefined) {
        break;
      }
      const parts = splitArchivePath(entry.path);
      if (parts === undefined) {
        summary.skipped.unsupportedType += 1;
        continue;
      }
      // Drop the single top folder GitHub adds (`owner-repo-sha/`); the folder itself is not counted.
      const relative = parts.slice(1);
      if (relative.length === 0) {
        continue;
      }
      entries += 1;
      const folders = entry.kind === 'directory' ? relative : relative.slice(0, -1);
      if (entries > limits.maxEntries || folders.length > limits.maxDepth) {
        summary.truncated = true;
        break;
      }
      const excludedAt = folders.findIndex(isExcludedDirectory);
      if (excludedAt !== -1) {
        const excluded = folders.slice(0, excludedAt + 1).join('/');
        if (!countedExclusions.has(excluded)) {
          countedExclusions.add(excluded);
          summary.skipped.excludedDirectory += 1;
        }
        continue;
      }
      const relativePath = relative.join('/');
      if (entry.kind === 'link') {
        summary.skipped.symlink += 1;
        continue;
      }
      if (entry.kind === 'other') {
        summary.skipped.unsupportedType += 1;
        continue;
      }
      if (entry.kind === 'directory') {
        // The trailing slash makes the folder itself count as a parent, as the walker's rule does.
        summary.productionMarker ||= productionMarkerFor(`${relativePath}/`);
        continue;
      }
      summary.productionMarker ||= productionMarkerFor(relativePath);
      if (!isSupportedFile(relative[relative.length - 1]!)) {
        summary.skipped.unsupportedType += 1;
        yield { relativePath };
        continue;
      }
      if (entry.size > limits.maxFileBytes) {
        summary.skipped.tooLarge += 1;
        continue;
      }
      const bytes = await tar.readBody();
      if (bytes === undefined) {
        break;
      }
      if (bytes.subarray(0, limits.binaryProbeBytes).includes(0)) {
        summary.skipped.binary += 1;
        continue;
      }
      if (summary.filesRead >= limits.maxFiles) {
        summary.truncated = true;
        break;
      }
      summary.filesRead += 1;
      yield { relativePath, text: decoder.decode(bytes) };
    }
    if (compressed.capped || source.capped) {
      summary.truncated = true;
    } else if (tar.unexpectedEnd) {
      throw new GitHubArchiveError();
    }
  } finally {
    // Stop gunzip and release the download, whatever state they are in.
    await inflater.return(undefined);
    await release(download);
  }
  return summary;
}
