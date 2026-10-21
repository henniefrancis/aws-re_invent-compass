import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createLocalPageOpener } from '../../src/runtime/browser-opener.js';
import type { ExecFileLike } from '../../src/runtime/browser-opener.js';

// Feature: compass-power, task 48 (P3.3): the QR page opens without a shell, as one argument.

const PAGE = join(tmpdir(), 'compass-qr-abc', 'board-qr.html');

function arrange(platform: string, exec?: ExecFileLike) {
  const launched: { file: string; args: string[] }[] = [];
  const open = createLocalPageOpener({
    platform,
    execFile:
      exec ??
      ((file, args, callback) => {
        launched.push({ file, args });
        callback(null);
      }),
  });
  return { open, launched };
}

describe('local page opener', () => {
  test('runs the platform command with the file URL as one argument and resolves true', async () => {
    for (const [platform, file] of [
      ['win32', 'rundll32'],
      ['darwin', 'open'],
      ['linux', 'xdg-open'],
    ] as const) {
      const { open, launched } = arrange(platform);
      expect(await open(PAGE)).toBe(true);
      expect(launched).toEqual([
        {
          file,
          args: [
            ...(platform === 'win32' ? ['url.dll,FileProtocolHandler'] : []),
            pathToFileURL(PAGE).href,
          ],
        },
      ]);
    }
  });

  test('a relative path or a file that is not .html is never launched', async () => {
    const { open, launched } = arrange('linux');
    expect(await open('board-qr.html')).toBe(false);
    expect(await open(join(tmpdir(), 'evil.sh'))).toBe(false);
    expect(launched).toEqual([]);
  });

  test('a failed or throwing launcher resolves false', async () => {
    const failing = arrange('linux', (_file, _args, callback) => callback(new Error('no browser')));
    expect(await failing.open(PAGE)).toBe(false);
    const throwing = arrange('linux', () => {
      throw new Error('spawn failed');
    });
    expect(await throwing.open(PAGE)).toBe(false);
  });
});

// Security review M1: a command that never returns (an xdg-open waiting on the browser) does not
// hang the tool; the open counts as failed so the chat gets the QR code instead.
describe('local page opener timeout', () => {
  test('resolves false when the command never calls back', async () => {
    const open = createLocalPageOpener({
      platform: 'linux',
      execFile: () => undefined,
      timeoutMs: 5,
    });
    expect(await open(PAGE)).toBe(false);
  });

  test('a command that answers in time is not cut off', async () => {
    const open = createLocalPageOpener({
      platform: 'linux',
      execFile: (_file, _args, callback) => {
        setTimeout(() => {
          callback(null);
        }, 1);
      },
      timeoutMs: 1000,
    });
    expect(await open(PAGE)).toBe(true);
  });
});
