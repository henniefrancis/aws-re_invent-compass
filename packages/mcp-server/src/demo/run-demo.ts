// The demo (Requirements 18.2 and 18.3): the whole Compass flow in ten steps through the real tools
// and the real server, against the Simulated_Runtime. It prints a heading and a short plain-English
// line per step, the block reasons for the clash, the swap steps and the terminal QR code. It makes
// no network request (the runtime it is given is simulated) and writes nothing outside the
// workspace it was given. It returns 0 when every step succeeds, or prints which step failed and
// returns 1.

import type { McpToolInput, McpToolName, McpToolOutput } from '@compass/contracts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Runtime } from '../ports/runtime.js';
import { DATA_PREAMBLE, ATTENDEE_PREAMBLE } from '../safety/labelled-data.js';
import { messageFor } from '../server/error-messages.js';
import { SIMULATED_LABEL } from '../server/results.js';
import { connectDemoClient } from './in-memory-client.js';
import { DEMO_TRIPLE } from './triple.js';

/** Where the demo writes. */
export interface DemoOutput {
  write(chunk: string): unknown;
  /** True for a terminal: only then does the demo add colour codes (to the QR code). */
  isTTY?: boolean;
}

/** What the demo needs besides the runtime. */
export interface DemoOptions {
  /** The folder the scan step reads. The demo's runtime must use a copy as its workspace. */
  repoPath: string;
}

/** A step that did not do what the demo expects. The message is plain English. */
class StepFailure extends Error {}

interface DemoApi {
  call<K extends McpToolName>(
    name: K,
    args: McpToolInput<K>,
  ): Promise<{ output: McpToolOutput<K>; text: string }>;
  label(which: 'a' | 'aRepeat' | 'b'): string;
  repoPath: string;
}

interface Step {
  title: string;
  run(api: DemoApi): Promise<string[]>;
}

const ESC = String.fromCharCode(0x1b);
/** A line of the text QR code: only spaces and block characters, with at least one block. */
const QR_LINE = new RegExp('^[ \u2580\u2584\u2588]*[\u2580\u2584\u2588][ \u2580\u2584\u2588]*$');

/** Black on white for a QR line, so it scans on a dark terminal too. Only used on a terminal. */
export function styleQrLine(line: string): string {
  return QR_LINE.test(line) ? `${ESC}[30;47m${line}${ESC}[0m` : line;
}

const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g');
const clean = (value: string): string => value.replace(CONTROL, ' ');

/** The server's own words: everything before the first data block, without the simulated label. */
export function proseOf(text: string): string[] {
  const lines = text.split('\n');
  const end = lines.findIndex((line) => line === DATA_PREAMBLE || line === ATTENDEE_PREAMBLE);
  return (end === -1 ? lines : lines.slice(0, end)).filter(
    (line) => line !== SIMULATED_LABEL && line.trim() !== '',
  );
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new StepFailure(message);
  }
}

const { a, aRepeat, b } = DEMO_TRIPLE;

const STEPS: Step[] = [
  {
    title: 'Sign in and load the catalog',
    run: async (api) => {
      await api.call('sign_in', {});
      const { output } = await api.call('refresh_catalog', {});
      expect(output.sessionCount > 0, 'The simulated catalog had no sessions.');
      return [
        'You are signed in to the simulated AWS Events service. No browser opens and nothing leaves this machine.',
        `Loaded ${output.sessionCount} sessions from the synthetic catalog.`,
      ];
    },
  },
  {
    title: 'Scan the sample repo',
    run: async (api) => {
      const { output } = await api.call('scan_repo', { path: api.repoPath });
      expect(output.services.length > 0, 'The scan found no AWS services in the sample repo.');
      return [
        `Compass read the sample repo and found ${output.services.length} AWS services. Only service names and depth leave the scanner, never file contents.`,
        ...output.services.slice(0, 6).map((service) => `  ${clean(service)}`),
      ];
    },
  },
  {
    title: 'Plan the week',
    run: async (api) => {
      const { output, text } = await api.call('plan_week', { maxPerDay: 3 });
      expect(output.commitments.length > 0, 'The plan came back empty.');
      return [
        `Compass planned ${output.commitments.length} sessions from what the repo uses, and wrote the plan as a Kiro spec in the workspace.`,
        ...proseOf(text).slice(0, 2),
      ];
    },
  },
  {
    title: 'A clash is blocked',
    run: async (api) => {
      await api.call('reserve_with_guardrails', { sessionIds: [a] });
      const { output } = await api.call('reserve_with_guardrails', { sessionIds: [b] });
      expect(
        output.verdict.decision === 'block' && output.result === undefined,
        'The overlapping session was not blocked.',
      );
      return [
        `Compass reserved ${api.label('a')} first.`,
        `You then ask for ${api.label('b')}, which overlaps it. The guardrail blocks it, and nothing is sent to the Events service.`,
        ...output.verdict.reasons.map((reason) => `  Reason: ${clean(reason)}`),
      ];
    },
  },
  {
    title: 'A safe swap',
    run: async (api) => {
      const held = await api.call('reserve_with_guardrails', { sessionIds: [aRepeat] });
      expect(
        held.output.result?.successful.includes(aRepeat) === true,
        'The repeat could not be reserved.',
      );
      const { output, text } = await api.call('cancel_reservation', { sessionId: a });
      expect(output.cancelled, 'The first booking was not cancelled by the swap.');
      return [
        `Compass reserved the repeat ${api.label('aRepeat')} first, so the swap is safe.`,
        'Only then does it cancel the first booking, so you never end up with neither seat.',
        ...proseOf(text).map((line) => `  ${clean(line)}`),
      ];
    },
  },
  {
    title: 'Reserve the session that clashed',
    run: async (api) => {
      const { output } = await api.call('reserve_with_guardrails', { sessionIds: [b] });
      expect(
        output.result?.successful.includes(b) === true,
        'The session could not be reserved after the swap.',
      );
      return [
        `With the clash gone, ${api.label('b')} is reserved, and the schedule read back confirms it.`,
      ];
    },
  },
  {
    title: 'Issue boarding passes',
    run: async (api) => {
      const { output } = await api.call('issue_boarding_passes', { sessionIds: [aRepeat, b] });
      expect(output.issued.length === 2, 'The boarding passes were not issued.');
      return [
        `Compass issued ${output.issued.length} boarding passes through the in-process pass service. They are unofficial; your badge is your ticket.`,
      ];
    },
  },
  {
    title: 'Hand the passes to your phone',
    run: async (api) => {
      const { output, text } = await api.call('send_to_phone', {});
      expect(output.handoffUrl.length > 0, 'No phone link was created.');
      return [
        'Compass made a 15-minute link for your phone. The link never resolves in simulated mode.',
        ...proseOf(text)
          .filter((line) => !line.startsWith('Open this link'))
          .map((line) => `  ${line}`),
        `  Link expires at ${clean(output.expiresAt)}.`,
      ];
    },
  },
  {
    title: 'Cancel a session',
    run: async (api) => {
      const { output, text } = await api.call('cancel_reservation', { sessionId: b });
      expect(output.cancelled, 'The cancellation was not applied.');
      return [`You cancel ${api.label('b')}.`, ...proseOf(text).map((line) => `  ${clean(line)}`)];
    },
  },
  {
    title: 'Void the pass',
    run: async (api) => {
      const { output } = await api.call('sync_passes', {});
      expect(
        output.voided.length === 1 && output.voided.includes(b),
        'The pass for the cancelled session was not voided.',
      );
      return [
        `Compass synced your passes with your schedule: ${output.voided.length} voided, ${output.issued.length} issued. The pass for the cancelled session is voided and the others are left alone.`,
      ];
    },
  },
];

/** The ten steps, for tests that check the order of the headings. */
export const DEMO_STEP_TITLES: readonly string[] = STEPS.map((step) => step.title);

/** Runs the demo. Returns the exit code: 0 when every step succeeds, otherwise 1. */
export async function runDemo(
  io: { stdout: DemoOutput; stderr: DemoOutput },
  runtime: Runtime,
  options: DemoOptions,
): Promise<number> {
  const client = await connectDemoClient(runtime);
  const api: DemoApi = {
    repoPath: options.repoPath,
    call: async (name, args) => {
      const result: CallToolResult = await client.call(name, args);
      const text = result.content
        .flatMap((item) => (item.type === 'text' ? [item.text] : []))
        .join('\n');
      if (result.isError === true) {
        throw new StepFailure(clean(text));
      }
      return { output: result.structuredContent as McpToolOutput<typeof name>, text };
    },
    label: (which) => `${DEMO_TRIPLE.codes[which]} "${DEMO_TRIPLE.titles[which]}"`,
  };

  io.stdout.write('reinvent-compass demo. Simulated mode: no real data and no network.\n');
  try {
    for (const [index, step] of STEPS.entries()) {
      const heading = `Step ${index + 1} of ${STEPS.length}: ${step.title}`;
      io.stdout.write(`\n${heading}\n`);
      try {
        for (const line of await step.run(api)) {
          io.stdout.write(`${io.stdout.isTTY === true ? styleQrLine(line) : line}\n`);
        }
      } catch (error) {
        const reason = error instanceof StepFailure ? error.message : messageFor(error);
        io.stderr.write(`\n${heading} failed.\n${reason}\n`);
        return 1;
      }
    }
  } finally {
    await client.close();
  }
  io.stdout.write('\nThe demo finished. Every step worked.\n');
  return 0;
}
