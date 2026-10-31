import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type { SourceFile } from '../../src/scanner/source-file.js';
import type { WalkSummary } from '../../src/scanner/walker.js';
import {
  CODELOAD_PREFIX,
  DEFAULT_ARCHIVE_LIMITS,
  readRepositoryArchive,
  splitArchivePath,
  type ArchiveLimits,
} from '../../src/github/archive.js';
import {
  GitHubArchiveError,
  GitHubNetworkError,
  GitHubNotConnectedError,
  GitHubRateLimitedError,
  GitHubRepositoryNotFoundError,
  GitHubRequestError,
} from '../../src/github/errors.js';
import type { GitHubFetch, GitHubResponseLike } from '../../src/github/http.js';
import {
  SECRET_ACCESS,
  TOP,
  brokenStreamResponse,
  bytesOf,
  errorText,
  fakeFetch,
  githubTarball,
  gzip,
  jsonResponse,
  longNameEntry,
  paxEntry,
  streamResponse,
  tarEntry,
  tarball,
} from './support.js';

const CODELOAD = 'https://codeload.github.com/octo/hello/legacy.tar.gz/refs/heads/main';

/** A fake GitHub: the API redirects to codeload, which serves `archive`. */
function github(
  archive: Uint8Array | GitHubResponseLike,
  redirect: GitHubResponseLike = jsonResponse(302, '', { location: CODELOAD }),
) {
  const served = archive instanceof Uint8Array ? streamResponse(200, archive) : archive;
  const { fetch, calls } = fakeFetch((url) =>
    url.startsWith('https://api.github.com/') ? redirect : served,
  );
  return { fetch, calls };
}

async function drain(
  generator: AsyncGenerator<SourceFile, WalkSummary>,
): Promise<{ files: SourceFile[]; summary: WalkSummary }> {
  const files: SourceFile[] = [];
  for (;;) {
    const next = await generator.next();
    if (next.done === true) {
      return { files, summary: next.value };
    }
    files.push(next.value);
  }
}

function read(fetch: GitHubFetch, limits?: Partial<ArchiveLimits>, fullName = 'octo/hello') {
  return drain(
    readRepositoryArchive({
      fullName,
      accessToken: SECRET_ACCESS,
      fetch,
      ...(limits === undefined ? {} : { limits }),
    }),
  );
}

const at = (path: string) => `${TOP}/${path}`;

describe('splitArchivePath', () => {
  test('splits a relative path and refuses absolute or climbing paths', () => {
    expect(splitArchivePath('a/./b//c.ts')).toEqual(['a', 'b', 'c.ts']);
    expect(splitArchivePath('/etc/passwd')).toBeUndefined();
    expect(splitArchivePath('\\\\server\\share')).toBeUndefined();
    expect(splitArchivePath('C:/x')).toBeUndefined();
    expect(splitArchivePath('top/../../x')).toBeUndefined();
  });
});

describe('readRepositoryArchive requests', () => {
  test('asks the API with the token and manual redirects, then codeload without the token', async () => {
    const { fetch, calls } = github(gzip(githubTarball([tarEntry(at('a.ts'), 'x')])));
    const signal = new AbortController().signal;
    await drain(
      readRepositoryArchive({ fullName: 'octo/hello', accessToken: SECRET_ACCESS, fetch, signal }),
    );
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://api.github.com/repos/octo/hello/tarball');
    expect(calls[0].init.redirect).toBe('manual');
    expect(calls[0].init.headers.authorization).toBe(`Bearer ${SECRET_ACCESS}`);
    expect(calls[0].init.signal).toBe(signal);
    expect(calls[1].url).toBe(CODELOAD);
    expect(calls[1].init.redirect).toBe('error');
    expect(calls[1].init.signal).toBe(signal);
    expect(JSON.stringify(calls[1].init)).not.toContain(SECRET_ACCESS);
    expect(Object.keys(calls[1].init.headers).map((h) => h.toLowerCase())).toEqual(['user-agent']);
    expect(CODELOAD_PREFIX).toBe('https://codeload.github.com/');
  });

  test('a malformed name is refused before any request', async () => {
    const { fetch, calls } = github(new Uint8Array(0));
    await expect(read(fetch, undefined, 'octo/../x')).rejects.toBeInstanceOf(
      GitHubRepositoryNotFoundError,
    );
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['another host', 'https://evil.example/archive.tar.gz'],
    ['a look-alike host', 'https://codeload.github.com.evil.example/x'],
    ['plain http', 'http://codeload.github.com/x'],
    ['api.github.com itself', 'https://api.github.com/x'],
  ])('a redirect to %s is refused and nothing more is fetched', async (_label, location) => {
    const { fetch, calls } = github(new Uint8Array(0), jsonResponse(302, '', { location }));
    const error = await read(fetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubArchiveError);
    expect(errorText(error)).not.toContain(SECRET_ACCESS);
    expect(errorText(error)).not.toContain('evil');
    expect(calls).toHaveLength(1);
  });

  test('every other answer from the API is refused with a typed error', async () => {
    const answer = async (response: GitHubResponseLike): Promise<unknown> => {
      const { fetch } = github(new Uint8Array(0), response);
      const error = await read(fetch).catch((e: unknown) => e);
      expect(errorText(error)).not.toContain(SECRET_ACCESS);
      return error;
    };
    expect(await answer(jsonResponse(302, ''))).toBeInstanceOf(GitHubArchiveError);
    expect(await answer(jsonResponse(404, ''))).toBeInstanceOf(GitHubRepositoryNotFoundError);
    expect(await answer(jsonResponse(401, ''))).toBeInstanceOf(GitHubNotConnectedError);
    expect(await answer(jsonResponse(429, ''))).toBeInstanceOf(GitHubRateLimitedError);
    const ok = await answer(streamResponse(200, new Uint8Array(10)));
    expect(ok).toBeInstanceOf(GitHubRequestError);
    expect((ok as GitHubRequestError).status).toBe(200);
    expect(
      ((await answer(jsonResponse(301, '', { location: CODELOAD }))) as GitHubRequestError).status,
    ).toBe(301);
  });

  test('a failing codeload answer is a typed error and its body is released', async () => {
    const answer = async (response: GitHubResponseLike): Promise<unknown> => {
      const { fetch } = github(response);
      return read(fetch).catch((e: unknown) => e);
    };
    expect(await answer(jsonResponse(401, ''))).toBeInstanceOf(GitHubNotConnectedError);
    const notFound = streamResponse(404, new Uint8Array(10));
    expect(((await answer(notFound)) as GitHubRequestError).status).toBe(404);
    await Promise.resolve();
    expect(notFound.cancelled()).toBe(true);
    expect(((await answer(jsonResponse(200, ''))) as GitHubRequestError).status).toBe(200);
    const network = await read(
      fakeFetch((url) => {
        if (url.startsWith('https://api.github.com/')) {
          return jsonResponse(302, '', { location: CODELOAD });
        }
        throw new Error(`reset ${SECRET_ACCESS}`);
      }).fetch,
    ).catch((e: unknown) => e);
    expect(network).toBeInstanceOf(GitHubNetworkError);
    expect(errorText(network)).not.toContain(SECRET_ACCESS);
  });
});

describe('readRepositoryArchive content', () => {
  test('applies the scanner rules to every entry', async () => {
    const longPath = `src/${'nested/'.repeat(20)}handler.ts`;
    const archive = gzip(
      githubTarball([
        tarEntry(at('src/'), '', { type: '5' }),
        tarEntry(at('src/app.ts'), "import { S3Client } from '@aws-sdk/client-s3';\n"),
        tarEntry(at('package.json'), '{"name":"x"}'),
        tarEntry(at('README.md'), '# hello'),
        tarEntry(at('node_modules/'), '', { type: '5' }),
        tarEntry(at('node_modules/x/index.js'), 'x'),
        tarEntry(at('node_modules/y/index.js'), 'y'),
        tarEntry(at('lib/dist/out.js'), 'z'),
        tarEntry(at('envs/'), '', { type: '5' }),
        tarEntry(at('envs/prod/'), '', { type: '5' }),
        tarEntry(at('envs/prod/main.tf'), 'resource "aws_s3_bucket" "b" {}\n'),
        tarEntry(at('link.ts'), '', { type: '2' }),
        tarEntry(at('hard.ts'), '', { type: '1' }),
        tarEntry(at('pipe'), '', { type: '6' }),
        tarEntry(at('image.js'), new Uint8Array([0x47, 0x00, 0x49])),
        tarEntry(at('big.ts'), 'x'.repeat(2000)),
        tarEntry(`${TOP}/../evil.ts`, 'evil'),
        tarEntry('/etc/passwd.js', 'root'),
        paxEntry({ path: at(longPath) }),
        tarEntry('ignored', 'export const a = 1;\n'),
        longNameEntry(at('gnu/very/long/name.py')),
        tarEntry('ignored', 'import boto3\n'),
        tarEntry('stray-top-level-file', 'x'),
      ]),
    );
    const { fetch } = github(archive);
    const { files, summary } = await read(fetch, { maxFileBytes: 1000 });
    expect(files).toEqual([
      { relativePath: 'src/app.ts', text: "import { S3Client } from '@aws-sdk/client-s3';\n" },
      { relativePath: 'package.json', text: '{"name":"x"}' },
      { relativePath: 'README.md' },
      { relativePath: 'envs/prod/main.tf', text: 'resource "aws_s3_bucket" "b" {}\n' },
      { relativePath: longPath, text: 'export const a = 1;\n' },
      { relativePath: 'gnu/very/long/name.py', text: 'import boto3\n' },
    ]);
    expect(summary).toEqual({
      filesRead: 5,
      skipped: {
        excludedDirectory: 2,
        gitignored: 0,
        tooLarge: 1,
        binary: 1,
        symlink: 2,
        unsupportedType: 4,
      },
      truncated: false,
      productionMarker: true,
    });
  });

  test('a production folder alone sets the marker, and a production tfvars file yields its name', async () => {
    const folder = github(
      gzip(githubTarball([tarEntry(at('stages/production/'), '', { type: '5' })])),
    );
    expect((await read(folder.fetch)).summary.productionMarker).toBe(true);
    const tfvars = github(gzip(githubTarball([tarEntry(at('prod.tfvars'), 'a = 1')])));
    const result = await read(tfvars.fetch);
    expect(result.files).toEqual([{ relativePath: 'prod.tfvars' }]);
    expect(result.summary.productionMarker).toBe(true);
    const plain = github(gzip(githubTarball([tarEntry(at('src/'), '', { type: '5' })])));
    expect((await read(plain.fetch)).summary.productionMarker).toBe(false);
  });

  test('stops at maxFiles, maxEntries and maxDepth and says truncated', async () => {
    const three = gzip(
      githubTarball([
        tarEntry(at('a.ts'), 'a'),
        tarEntry(at('b.ts'), 'b'),
        tarEntry(at('c.ts'), 'c'),
      ]),
    );
    const files = await read(github(three).fetch, { maxFiles: 2 });
    expect(files.files).toHaveLength(2);
    expect(files.summary).toMatchObject({ filesRead: 2, truncated: true });

    const entries = await read(github(three).fetch, { maxEntries: 1 });
    expect(entries.files).toHaveLength(1);
    expect(entries.summary.truncated).toBe(true);

    const deep = gzip(githubTarball([tarEntry(at('a/b/c/d.ts'), 'd'), tarEntry(at('e.ts'), 'e')]));
    const depth = await read(github(deep).fetch, { maxDepth: 2 });
    expect(depth.files).toHaveLength(0);
    expect(depth.summary.truncated).toBe(true);
    const deepFolder = gzip(githubTarball([tarEntry(at('a/b/c/'), '', { type: '5' })]));
    expect((await read(github(deepFolder).fetch, { maxDepth: 2 })).summary.truncated).toBe(true);
  });

  test('a tar bomb stops at the unpacked cap without reading the rest', async () => {
    // 64 MiB of zeros gzips to about 64 KiB; the cap is 1 MiB unpacked.
    // A 2 MB incompressible tail follows, so reading on would show in the bytes pulled.
    const bomb = gzip(
      githubTarball([
        tarEntry(at('bomb.ts'), new Uint8Array(64 * 1024 * 1024)),
        tarEntry(at('after.bin'), randomBytes(2 * 1024 * 1024)),
      ]),
    );
    expect(bomb.length).toBeGreaterThan(2 * 1024 * 1024);
    const served = streamResponse(200, bomb);
    const { fetch } = github(served);
    const { files, summary } = await read(fetch, { maxUnpackedBytes: 1024 * 1024 });
    expect(files).toEqual([]);
    expect(summary.truncated).toBe(true);
    expect(served.pulled()).toBeLessThan(64 * 1024);
    expect(served.cancelled()).toBe(true);

    // The same bomb with a file size limit above the cap stops inside the body read.
    const again = github(bomb);
    const inside = await read(again.fetch, {
      maxUnpackedBytes: 1024 * 1024,
      maxFileBytes: 128 * 1024 * 1024,
    });
    expect(inside.files).toEqual([]);
    expect(inside.summary.truncated).toBe(true);
  });

  test('a huge download stops at the compressed cap as it streams', async () => {
    const noise = gzip(githubTarball([tarEntry(at('noise.bin'), randomBytes(400 * 1024))]));
    const served = streamResponse(200, noise);
    const { fetch } = github(served);
    const { summary } = await read(fetch, { maxCompressedBytes: 64 * 1024 });
    expect(summary.truncated).toBe(true);
    expect(served.cancelled()).toBe(true);
  });

  test('a declared size over the compressed cap is refused before reading', async () => {
    const response = streamResponse(200, new Uint8Array(10), {
      'content-length': String(DEFAULT_ARCHIVE_LIMITS.maxCompressedBytes + 1),
    });
    const { fetch } = github(response);
    const { files, summary } = await read(fetch);
    expect(files).toEqual([]);
    expect(summary.truncated).toBe(true);
    await Promise.resolve();
    expect(response.cancelled()).toBe(true);
  });

  test('the default caps are 100 MB compressed and 500 MB unpacked on top of the walk limits', () => {
    expect(DEFAULT_ARCHIVE_LIMITS).toMatchObject({
      maxCompressedBytes: 100 * 1024 * 1024,
      maxUnpackedBytes: 500 * 1024 * 1024,
      maxFiles: 20000,
      maxFileBytes: 1048576,
      binaryProbeBytes: 8192,
      maxEntries: 200000,
    });
  });

  test('a corrupt gzip stream, a cut archive and a broken connection are archive errors', async () => {
    await expect(read(github(bytesOf('this is not gzip at all')).fetch)).rejects.toBeInstanceOf(
      GitHubArchiveError,
    );
    const whole = githubTarball([tarEntry(at('a.ts'), 'x'.repeat(3000))]);
    const cutInSkip = gzip(whole.subarray(0, 512 * 4 + 100));
    await expect(read(github(cutInSkip).fetch, { maxFileBytes: 10 })).rejects.toBeInstanceOf(
      GitHubArchiveError,
    );
    await expect(read(github(cutInSkip).fetch)).rejects.toBeInstanceOf(GitHubArchiveError);
    await expect(read(github(brokenStreamResponse(200)).fetch)).rejects.toBeInstanceOf(
      GitHubArchiveError,
    );
  });

  test('a consumer that stops early releases the download', async () => {
    const archive = gzip(
      githubTarball([tarEntry(at('a.ts'), 'a'), tarEntry(at('b.ts'), randomBytes(200_000))]),
    );
    const served = streamResponse(200, archive, {}, 256);
    const { fetch } = github(served);
    const generator = readRepositoryArchive({ fullName: 'octo/hello', accessToken: 't', fetch });
    expect((await generator.next()).value).toEqual({ relativePath: 'a.ts', text: 'a' });
    expect(served.pulled()).toBeLessThan(archive.length / 2);
    await generator.return({} as WalkSummary);
    expect(served.cancelled()).toBe(true);
  });

  test('an empty archive yields nothing', async () => {
    const { files, summary } = await read(github(gzip(tarball([]))).fetch);
    expect(files).toEqual([]);
    expect(summary.filesRead).toBe(0);
    expect(summary.truncated).toBe(false);
  });
});
