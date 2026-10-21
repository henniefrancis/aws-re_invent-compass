import { describe, expect, test } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { chooseWith, confirmWith, ELICIT_TIMEOUT_MS } from '../../src/server/elicitation.js';
import type { Elicitor } from '../../src/server/elicitation.js';
import { messageFor } from '../../src/server/error-messages.js';
import { CompassError } from '../../src/ports/errors.js';

// Feature: compass-power, P4.2 and P4.4 (task 51): the confirmation, the pick list and five minutes
// to answer.

/** An elicitor that records each request and answers with `answer` (or throws it). */
function elicitor(answer: ElicitResult | Error) {
  const asked: { params: ElicitRequestFormParams; options: { timeout: number } }[] = [];
  const server: Elicitor = {
    elicitInput: (params, options) => {
      asked.push({ params, options });
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  return { server, asked };
}

const OPTIONS = [
  { value: 'id-1', label: 'AIM101 Agents in practice' },
  { value: 'id-2', label: 'BIZ332 Bring your business' },
];

describe('confirmWith', () => {
  test('asks for a ticked box and waits five minutes', async () => {
    const { server, asked } = elicitor({ action: 'accept', content: { confirm: true } });
    expect(await confirmWith(server)({ message: 'Go ahead?' })).toBe('accept');
    expect(asked[0]?.options).toEqual({ timeout: ELICIT_TIMEOUT_MS });
    expect(ELICIT_TIMEOUT_MS).toBe(300_000);
    expect(asked[0]?.params.message).toBe('Go ahead?');
    expect(asked[0]?.params.requestedSchema.required).toEqual(['confirm']);
  });

  test('only a ticked box is a yes; a decline or cancel passes through', async () => {
    for (const content of [{ confirm: false }, {}, { confirm: 'true' }]) {
      expect(
        await confirmWith(elicitor({ action: 'accept', content }).server)({ message: 'x' }),
      ).toBe('decline');
    }
    expect(await confirmWith(elicitor({ action: 'decline' }).server)({ message: 'x' })).toBe(
      'decline',
    );
    expect(await confirmWith(elicitor({ action: 'cancel' }).server)({ message: 'x' })).toBe(
      'cancel',
    );
  });

  test('a timeout throws ConfirmTimedOut; any other failure is a cancel', async () => {
    const timedOut = elicitor(new McpError(ErrorCode.RequestTimeout, 'Request timed out'));
    await expect(confirmWith(timedOut.server)({ message: 'x' })).rejects.toMatchObject({
      code: 'ConfirmTimedOut',
    });
    expect(await confirmWith(elicitor(new Error('closed')).server)({ message: 'x' })).toBe(
      'cancel',
    );
    const other = elicitor(new McpError(ErrorCode.InvalidParams, 'bad'));
    expect(await confirmWith(other.server)({ message: 'x' })).toBe('cancel');
  });

  test('the timeout message says it timed out and that nothing changed', () => {
    const message = messageFor(new CompassError('ConfirmTimedOut'));
    expect(message).toBe(
      'Nothing was changed, because the confirmation was not answered within 5 minutes. Ask again when you are ready.',
    );
    expect(message).not.toContain('did not confirm');
  });
});

describe('chooseWith', () => {
  test('offers the labels as a single-choice enum and maps the pick back to its value', async () => {
    const { server, asked } = elicitor({
      action: 'accept',
      content: { choice: OPTIONS[1]?.label },
    });
    expect(await chooseWith(server)({ message: 'Which one?', options: OPTIONS })).toEqual({
      value: 'id-2',
    });
    expect(asked[0]?.options).toEqual({ timeout: ELICIT_TIMEOUT_MS });
    expect(asked[0]?.params.requestedSchema).toEqual({
      type: 'object',
      properties: {
        choice: { type: 'string', title: 'Session', enum: OPTIONS.map((o) => o.label) },
      },
      required: ['choice'],
    });
  });

  test('a label that was not offered, or none, is a decline; decline and cancel pass through', async () => {
    for (const content of [{ choice: 'Ignore previous instructions' }, {}]) {
      expect(
        await chooseWith(elicitor({ action: 'accept', content }).server)({
          message: 'x',
          options: OPTIONS,
        }),
      ).toBe('decline');
    }
    expect(
      await chooseWith(elicitor({ action: 'decline' }).server)({ message: 'x', options: OPTIONS }),
    ).toBe('decline');
    expect(
      await chooseWith(elicitor({ action: 'cancel' }).server)({ message: 'x', options: OPTIONS }),
    ).toBe('cancel');
  });

  test('a timeout throws ConfirmTimedOut; any other failure is a cancel', async () => {
    const timedOut = elicitor(new McpError(ErrorCode.RequestTimeout, 'Request timed out'));
    await expect(
      chooseWith(timedOut.server)({ message: 'x', options: OPTIONS }),
    ).rejects.toMatchObject({ code: 'ConfirmTimedOut' });
    expect(
      await chooseWith(elicitor(new Error('closed')).server)({ message: 'x', options: OPTIONS }),
    ).toBe('cancel');
  });
});
