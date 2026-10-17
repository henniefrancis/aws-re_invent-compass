import { describe, expect, test } from 'vitest';
import {
  createAppDataResolver,
  joinInFolder,
  OUTPUT_FOLDER_NAME,
  RECORD_FILE_NAME,
} from '../../src/passes/app-data.js';
import { CompassError, createCompassClient } from '../../src/passes/compass-client.js';
import { forgetMe } from '../../src/passes/forget-me.js';
import { createPassStore } from '../../src/passes/pass-store.js';
import { PassError } from '../../src/passes/redaction.js';
import { memoryFs } from './memory-fs.js';
import { createContractMock, jsonResponse, problem } from './openapi-mock.js';
import { fakeClock, fakeIdToken } from './support.js';

// Tests for the forgetMe orchestrator (boarding-passes, S4, Requirement 2.7). It runs the
// real client over the contract mock, the real store and an in-memory filesystem.

const appData = createAppDataResolver({
  platform: 'linux',
  env: { XDG_DATA_HOME: '/home/ada/.local/share' },
  homeDir: '/home/ada',
});
const ROOT = appData.resolve();
const RECORD_PATH = joinInFolder(ROOT, RECORD_FILE_NAME);
const CALENDAR_PATH = joinInFolder(ROOT, OUTPUT_FOLDER_NAME, 'reinvent.ics');
const ITINERARY_PATH = joinInFolder(ROOT, OUTPUT_FOLDER_NAME, 'itinerary.html');
const STRAY_OUTPUT_PATH = joinInFolder(ROOT, OUTPUT_FOLDER_NAME, 'stray-export.txt');
const UNRELATED_PATH = joinInFolder(ROOT, 'notes.txt');

function rig() {
  const mock = createContractMock();
  const fs = memoryFs({
    [RECORD_PATH]: '{"passes":[]}',
    [CALENDAR_PATH]: 'BEGIN:VCALENDAR',
    [ITINERARY_PATH]: '<html></html>',
    [STRAY_OUTPUT_PATH]: 'left behind',
    [UNRELATED_PATH]: 'keep me',
  });
  const store = createPassStore({ appData, fs, clock: fakeClock() });
  const client = createCompassClient({
    baseUrl: 'https://d111111abcdef8.cloudfront.net',
    transport: mock,
    clock: fakeClock(),
    idToken: { getIdToken: () => Promise.resolve(fakeIdToken('attendee')) },
  });
  return { mock, fs, deps: { client, store, fs, appData } };
}

/** The copy must never claim a pass was deleted from a phone or a wallet. */
function expectNoPhoneClaim(copy: string): void {
  expect(copy).not.toMatch(
    /(deleted|removed|erased|wiped)\s+(from|on)\s+(your|the)\s+(phone|wallet|device)/i,
  );
  expect(copy).not.toMatch(/passes?\s+(was|were|are|have been)\s+(deleted|removed|erased)/i);
}

/** The confirmation copy must also say passes are voided and will expire. */
function expectHonestCopy(copy: string): void {
  expect(copy).toMatch(/voided/);
  expect(copy).toMatch(/expire/);
  expectNoPhoneClaim(copy);
}

describe('Feature: boarding-passes, forgetMe cleans up locally when the server accepted or holds nothing', () => {
  test('a 202 removes the record and the whole output folder, and nothing else', async () => {
    const { mock, fs, deps } = rig();
    mock.enqueue('forgetMe', jsonResponse(202, { voided: 3, deleted: 5 }));

    const outcome = await forgetMe(deps);

    expect(outcome.status).toBe(202);
    expect(outcome.localDataRemoved).toBe(true);
    expect([...fs.files.keys()]).toEqual([UNRELATED_PATH]);
    expect(outcome.copy).toContain('3 pass(es) were voided');
    expectHonestCopy(outcome.copy);
  });

  test('a 202 whose body does not match the contract still cleans up', async () => {
    for (const body of ['not json', JSON.stringify({ voided: 'many' })]) {
      const { mock, fs, deps } = rig();
      mock.enqueue('forgetMe', { status: 202, headers: {}, body });
      const outcome = await forgetMe(deps);
      expect(outcome.localDataRemoved).toBe(true);
      expect([...fs.files.keys()]).toEqual([UNRELATED_PATH]);
      expectHonestCopy(outcome.copy);
    }
  });

  test('a 404 or 410 (the server holds nothing) also cleans up, so a retry can finish the job', async () => {
    for (const response of [problem(404, 'not_found'), { status: 410, headers: {}, body: '' }]) {
      const { mock, fs, deps } = rig();
      mock.enqueue('forgetMe', response);
      const outcome = await forgetMe(deps);
      expect(outcome.localDataRemoved).toBe(true);
      expect([...fs.files.keys()]).toEqual([UNRELATED_PATH]);
      expect(outcome.copy).toContain('holds nothing');
      expectHonestCopy(outcome.copy);
    }
  });
});

describe('Feature: boarding-passes, forgetMe on any other status or error', () => {
  test('a success that is not a 202 leaves every local file untouched', async () => {
    const { mock, fs, deps } = rig();
    mock.enqueue('forgetMe', jsonResponse(200, { voided: 0, deleted: 0 }));
    const before = new Map(fs.files);

    const outcome = await forgetMe(deps);

    expect(outcome.status).toBe(200);
    expect(outcome.localDataRemoved).toBe(false);
    expect(fs.files).toEqual(before);
    expect(fs.ops.filter((op) => op.startsWith('remove '))).toEqual([]);
    expect(outcome.copy).toContain('200');
    expectNoPhoneClaim(outcome.copy);
  });

  test('a client error propagates and leaves every local file untouched', async () => {
    const { mock, fs, deps } = rig();
    mock.enqueue('forgetMe', problem(401, 'unauthorized'));
    const before = new Map(fs.files);

    await expect(forgetMe(deps)).rejects.toBeInstanceOf(CompassError);
    expect(fs.files).toEqual(before);
  });
});

describe('Feature: boarding-passes, forgetMe when a local file cannot be removed', () => {
  test('every removal is still attempted and a safe PassError is raised', async () => {
    const { fs, deps } = rig();
    fs.failing.add('remove');

    let caught: unknown;
    try {
      await forgetMe(deps);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PassError);
    const error = caught as PassError;
    expect(error.code).toBe('forget.local_removal_failed');
    expect(error.message).not.toContain('example.com');
    expect(error.message).not.toContain('/home/ada');
    const removals = fs.ops.filter((op) => op.startsWith('remove '));
    expect(removals).toContain(`remove ${RECORD_PATH}`);
    expect(removals).toContain(`remove ${joinInFolder(ROOT, OUTPUT_FOLDER_NAME)}`);
  });

  test('a failure removing only the record still tries the output folder', async () => {
    const { mock, fs, deps } = rig();
    mock.enqueue('forgetMe', jsonResponse(202, { voided: 0, deleted: 0 }));
    const store = { ...deps.store, deleteRecord: () => Promise.reject(new Error('locked')) };
    await expect(forgetMe({ ...deps, store })).rejects.toMatchObject({
      code: 'forget.local_removal_failed',
    });
    expect(fs.files.has(CALENDAR_PATH)).toBe(false);
  });
});
