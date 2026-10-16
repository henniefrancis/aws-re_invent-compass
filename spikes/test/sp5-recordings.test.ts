import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runShapeDiff, listRecordings } from '../src/shape-diff.ts';

// Unit test for the SP5 absent and empty recordings path (foundation-contracts, S0).
//
// Validates: Requirement 10.4.
//
// SP5 reports "no recordings present" with a zero exit code when fixtures/.raw/ is
// absent and when it exists but is empty (or has no .json files). When recordings
// are present it diffs them and still exits 0, printing field-level lines only.

const reference = { sessionId: 's', title: 't', venue: 'v' };

describe('Feature: foundation-contracts, SP5 recordings path', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sp5-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('absent directory: no recordings present, exit 0', async () => {
    const absent = join(dir, 'does-not-exist');
    expect(await listRecordings(absent)).toEqual([]);
    const result = await runShapeDiff({ rawDir: absent, reference });
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(['no recordings present']);
  });

  test('empty directory: no recordings present, exit 0', async () => {
    expect(await listRecordings(dir)).toEqual([]);
    const result = await runShapeDiff({ rawDir: dir, reference });
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(['no recordings present']);
  });

  test('directory with only non-json files: no recordings present, exit 0', async () => {
    await writeFile(join(dir, 'notes.txt'), 'not a recording', 'utf8');
    expect(await listRecordings(dir)).toEqual([]);
    const result = await runShapeDiff({ rawDir: dir, reference });
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(['no recordings present']);
  });

  test('directory with a recording: diffs it and still exits 0, leaking no value', async () => {
    const recording = { sessionId: 'LEAK_id', title: 'LEAK_title', extra: 'LEAK_extra' };
    await writeFile(join(dir, 'get-session.json'), JSON.stringify(recording), 'utf8');

    const recordings = await listRecordings(dir);
    expect(recordings).toHaveLength(1);

    const result = await runShapeDiff({ rawDir: dir, reference });
    expect(result.exitCode).toBe(0);
    const report = result.lines.join('\n');
    // It names the recording file and reports the only-in-recording field by name.
    expect(report).toContain('extra');
    // It never leaks a recorded value.
    for (const leak of ['LEAK_id', 'LEAK_title', 'LEAK_extra']) {
      expect(report.includes(leak)).toBe(false);
    }
  });

  test('an array recording is compared by its first element', async () => {
    const recording = [{ sessionId: 'LEAK_a', newField: 1 }, { sessionId: 'LEAK_b' }];
    await writeFile(join(dir, 'list-sessions.json'), JSON.stringify(recording), 'utf8');
    const result = await runShapeDiff({ rawDir: dir, reference });
    expect(result.exitCode).toBe(0);
    const report = result.lines.join('\n');
    expect(report).toContain('newField');
    expect(report.includes('LEAK_a')).toBe(false);
    expect(report.includes('LEAK_b')).toBe(false);
  });
});
