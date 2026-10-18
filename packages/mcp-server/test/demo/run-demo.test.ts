import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CompassError } from '../../src/ports/errors.js';
import { DEMO_STEP_TITLES, proseOf, runDemo, styleQrLine } from '../../src/demo/run-demo.js';
import { DATA_PREAMBLE } from '../../src/safety/labelled-data.js';
import { SIMULATED_LABEL } from '../../src/server/results.js';
import { installNetworkGuard } from '../support/network-guard.js';
import type { NetworkGuard } from '../support/network-guard.js';
import { buildSimulatedStack } from '../support/simulated-stack.js';
import type { SimulatedStack } from '../support/simulated-stack.js';
import { TRIPLE } from '../support/triple.js';

let guard: NetworkGuard;
let stack: SimulatedStack;
beforeEach(async () => {
  guard = installNetworkGuard();
  stack = await buildSimulatedStack();
});
afterEach(async () => {
  guard.restore();
  await stack.cleanup();
});

function run() {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    stdout: { write: (c: string) => out.push(c) },
    stderr: { write: (c: string) => err.push(c) },
  };
  return { io, out, err, text: () => out.join(''), errText: () => err.join('') };
}

describe('the demo', () => {
  test('runs the ten steps in order through the real tools and exits 0', async () => {
    const { io, text, errText } = run();
    const code = await runDemo(io, stack.runtime, { repoPath: stack.workspace });
    expect(code).toBe(0);
    expect(errText()).toBe('');
    const headings = [...text().matchAll(/^Step (\d+) of 10: (.+)$/gm)];
    expect(headings.map((m) => m[2])).toEqual([...DEMO_STEP_TITLES]);
    expect(headings.map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(DEMO_STEP_TITLES).toHaveLength(10);
    expect(text()).toContain('Simulated mode: no real data and no network.');
    expect(text()).toContain('The demo finished. Every step worked.');
    expect(text()).toContain(`${TRIPLE.codes.a} "${TRIPLE.titles.a}"`);
    expect(text()).toContain('Reason:');
    expect(text()).toContain('Link expires at');
    expect(guard.attempts).toEqual([]);
  });

  test('the clash is blocked with no write, the swap reserves the repeat before it cancels, the pass is voided', async () => {
    const { io } = run();
    await runDemo(io, stack.runtime, { repoPath: stack.workspace });
    const reserves = stack.events.callsTo('reserve').map((c) => (c.args[0] as string[])[0]);
    expect(reserves).toEqual([TRIPLE.a, TRIPLE.aRepeat, TRIPLE.b]);
    expect(stack.events.callsTo('cancel').map((c) => c.args[0])).toEqual([TRIPLE.a, TRIPLE.b]);
    const order = stack.events.calls
      .filter((c) => c.method === 'reserve' || c.method === 'cancel')
      .map((c) => `${c.method}:${String(Array.isArray(c.args[0]) ? c.args[0][0] : c.args[0])}`);
    expect(order).toEqual([
      `reserve:${TRIPLE.a}`,
      `reserve:${TRIPLE.aRepeat}`,
      `cancel:${TRIPLE.a}`,
      `reserve:${TRIPLE.b}`,
      `cancel:${TRIPLE.b}`,
    ]);
    const voided = [...stack.passService.passes().values()].filter((p) => p.status !== 'active');
    expect(voided).toHaveLength(1);
  });

  test('the scan step reads the folder it is given', async () => {
    const { io, text } = run();
    await runDemo(io, stack.runtime, { repoPath: stack.workspace });
    expect(text()).toMatch(/found \d+ AWS services/);
  });
});

describe('demo failures', () => {
  test('a step that does not do what the demo expects is named, and the exit is 1', async () => {
    stack.events.reserveFailures.set(TRIPLE.aRepeat, { code: 'sessionFull' });
    const { io, text, errText } = run();
    const code = await runDemo(io, stack.runtime, { repoPath: stack.workspace });
    expect(code).toBe(1);
    expect(errText()).toContain('Step 5 of 10: A safe swap failed.');
    expect(errText()).toContain('The repeat could not be reserved.');
    expect(text()).not.toContain('Step 6 of 10');
  });

  test('a tool error is reported with its plain-English message', async () => {
    stack.events.failWith.set('signIn', new CompassError('Network'));
    const { io, errText } = run();
    expect(await runDemo(io, stack.runtime, { repoPath: stack.workspace })).toBe(1);
    expect(errText()).toContain('Step 1 of 10: Sign in and load the catalog failed.');
    expect(errText()).toContain('Compass could not reach the service.');
  });

  test('an unexpected failure inside a step is reported with the fixed message', async () => {
    const spy = vi
      .spyOn(Client.prototype, 'callTool')
      .mockRejectedValueOnce(new CompassError('Network'));
    const { io, errText } = run();
    expect(await runDemo(io, stack.runtime, { repoPath: stack.workspace })).toBe(1);
    spy.mockRestore();
    expect(errText()).toContain('Step 1 of 10: Sign in and load the catalog failed.');
    expect(errText()).toContain('Compass could not reach the service.');
  });

  test('a scan of an empty folder fails the scan step', async () => {
    const { io, errText } = run();
    expect(await runDemo(io, stack.runtime, { repoPath: `${stack.workspace}-missing` })).toBe(1);
    expect(errText()).toContain('Step 2 of 10: Scan the sample repo failed.');
    expect(errText()).toContain('That folder could not be found.');
  });
});

describe('proseOf', () => {
  test('keeps the server words, drops the simulated label, blank lines and the data block', () => {
    const text = [
      SIMULATED_LABEL,
      'First line.',
      '',
      'Second line.',
      DATA_PREAMBLE,
      '{ "x": 1 }',
    ].join('\n');
    expect(proseOf(text)).toEqual(['First line.', 'Second line.']);
    expect(proseOf('No data block here.')).toEqual(['No data block here.']);
  });
});

describe('the demo on a terminal and off one (QA low)', () => {
  const QR = /^[ ▀▄█]*[▀▄█][ ▀▄█]*$/;

  test('off a terminal there are no escape codes, and the QR code is printed once', async () => {
    const out: string[] = [];
    const io = {
      stdout: { write: (c: string) => out.push(c) },
      stderr: { write: () => undefined },
    };
    expect(await runDemo(io, stack.runtime, { repoPath: stack.workspace })).toBe(0);
    const text = out.join('');
    expect(text).not.toContain(String.fromCharCode(0x1b));
    const all = text.split('\n');
    const isQr = (line: string | undefined): boolean => line !== undefined && QR.test(line);
    expect(all.filter((line) => isQr(line)).length).toBeGreaterThan(5);
    // One block of consecutive QR lines, not two.
    const blocks = all.filter((line, index) => isQr(line) && !isQr(all[index - 1])).length;
    expect(blocks).toBe(1);
    const scans = text.match(/Or scan this QR code/g) ?? [];
    expect(scans).toHaveLength(1);
  });

  test('on a terminal only the QR lines get colour codes, black on white', async () => {
    const out: string[] = [];
    const io = {
      stdout: { write: (c: string) => out.push(c), isTTY: true },
      stderr: { write: () => undefined },
    };
    expect(await runDemo(io, stack.runtime, { repoPath: stack.workspace })).toBe(0);
    const esc = String.fromCharCode(0x1b);
    const lines = out.join('').split('\n');
    const colored = lines.filter((line) => line.includes(esc));
    expect(colored.length).toBeGreaterThan(5);
    for (const line of colored) {
      expect(line.startsWith(`${esc}[30;47m`)).toBe(true);
      expect(line.endsWith(`${esc}[0m`)).toBe(true);
      expect(QR.test(line.slice(`${esc}[30;47m`.length, -`${esc}[0m`.length))).toBe(true);
    }
  });

  test('styleQrLine leaves every other line alone', () => {
    expect(styleQrLine('Step 1 of 10: x')).toBe('Step 1 of 10: x');
    expect(styleQrLine('')).toBe('');
    expect(styleQrLine('    ')).toBe('    ');
    expect(styleQrLine('██  ██')).toContain(String.fromCharCode(0x1b));
  });
});
