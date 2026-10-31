// Asking the human through MCP elicitation (Requirements 8.5 and P4.4, compass-power task 51).
// Two forms: a yes or no confirmation (a ticked box) and a single choice from a list. Both wait up
// to five minutes; the SDK's default of 60 seconds turned a slow answer in Kiro into "you did not
// confirm". A timeout throws ConfirmTimedOut, so the tool changes nothing and says it timed out;
// every tool asks before it writes. Any other failure (an invalid answer, a closed connection) is
// not a yes, so no write follows.

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { CompassError } from '../ports/errors.js';
import type { ChoiceQuestion, ElicitAnswer, ElicitQuestion } from './types.js';

/** How long the attendee has to answer a confirmation or a choice. */
export const ELICIT_TIMEOUT_MS = 5 * 60 * 1000;

/** The part of the SDK server the elicitors use. */
export interface Elicitor {
  elicitInput(params: ElicitRequestFormParams, options: { timeout: number }): Promise<ElicitResult>;
}

async function ask(
  server: Elicitor,
  params: ElicitRequestFormParams,
): Promise<ElicitResult | undefined> {
  try {
    return await server.elicitInput(params, { timeout: ELICIT_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof McpError && error.code === Number(ErrorCode.RequestTimeout)) {
      throw new CompassError('ConfirmTimedOut');
    }
    return undefined;
  }
}

/** A yes or no confirmation: only a ticked box is a yes (QA M1, security L2). */
export function confirmWith(server: Elicitor): (question: ElicitQuestion) => Promise<ElicitAnswer> {
  return async (question) => {
    const answer = await ask(server, {
      message: question.message,
      requestedSchema: {
        type: 'object',
        properties: {
          confirm: {
            type: 'boolean',
            title: 'Confirm',
            description: 'Tick to confirm, or decline to stop.',
          },
        },
        required: ['confirm'],
      },
    });
    if (answer === undefined) {
      return 'cancel';
    }
    return answer.action === 'accept' && answer.content?.confirm !== true
      ? 'decline'
      : answer.action;
  };
}

/**
 * A single choice: the labels are offered as a string enum, the most widely supported
 * single-select form, and the picked label is mapped back to its value. A label that was not
 * offered, or no pick, is a decline.
 */
export function chooseWith(
  server: Elicitor,
): (question: ChoiceQuestion) => Promise<{ value: string } | 'decline' | 'cancel'> {
  return async (question) => {
    const answer = await ask(server, {
      message: question.message,
      requestedSchema: {
        type: 'object',
        properties: {
          choice: {
            type: 'string',
            title: 'Session',
            enum: question.options.map((option) => option.label),
          },
        },
        required: ['choice'],
      },
    });
    if (answer === undefined) {
      return 'cancel';
    }
    if (answer.action !== 'accept') {
      return answer.action;
    }
    const picked = question.options.find((option) => option.label === answer.content?.choice);
    return picked === undefined ? 'decline' : { value: picked.value };
  };
}
