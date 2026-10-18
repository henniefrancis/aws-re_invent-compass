import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyCli, isMain, maybeRunCli } from '../../scripts/cli.mjs';

describe('site script CLI helpers', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  test('applyCli writes output and sets the exit code', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    applyCli({ code: 3, stdout: 'hello', stderr: 'oops' });
    expect(out).toHaveBeenCalledWith('hello');
    expect(err).toHaveBeenCalledWith('oops');
    expect(process.exitCode).toBe(3);
  });

  test('applyCli writes nothing for empty output', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    applyCli({ code: 0 });
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  test('isMain compares the entry point with the module URL', () => {
    const file = import.meta.filename;
    expect(isMain(file, pathToFileURL(file).href)).toBe(true);
    expect(isMain(file, 'file:///elsewhere.mjs')).toBe(false);
    expect(isMain(undefined, pathToFileURL(file).href)).toBe(false);
  });

  test('maybeRunCli runs only for the entry point', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const file = import.meta.filename;
    const runCli = vi.fn(() => Promise.resolve({ code: 0, stdout: 'ok' }));
    expect(await maybeRunCli({ runCli, argv1: file, metaUrl: pathToFileURL(file).href })).toBe(
      true,
    );
    expect(runCli).toHaveBeenCalledTimes(1);
    expect(await maybeRunCli({ runCli, argv1: file, metaUrl: 'file:///elsewhere.mjs' })).toBe(
      false,
    );
    expect(runCli).toHaveBeenCalledTimes(1);
  });
});
