// The stderr logger (task 1.2). It writes only to an injected stderr stream, never to
// stdout (stdout carries MCP protocol messages only), and passes every line through
// redaction. Handlers log fixed messages and codes, never upstream error text.

import type { LogFields, Logger } from '../ports/logger.js';
import { redactText } from './redact.js';

function renderFields(fields: LogFields | undefined): string {
  if (fields === undefined) {
    return '';
  }
  return Object.entries(fields)
    .map(([key, value]) => ` ${redactText(key)}=${redactText(String(value))}`)
    .join('');
}

/** Anything with a string `write`, such as `process.stderr`. */
export interface StderrSink {
  write(chunk: string): unknown;
}

/** Creates a Logger that writes redacted lines to `stderr` only. */
export function createStderrLogger(stderr: StderrSink): Logger {
  const write = (level: string, message: string, fields?: LogFields): void => {
    stderr.write(`[reinvent-compass] ${level} ${redactText(message)}${renderFields(fields)}\n`);
  };
  return {
    info: (message, fields) => {
      write('info', message, fields);
    },
    warn: (message, fields) => {
      write('warn', message, fields);
    },
    error: (message, fields) => {
      write('error', message, fields);
    },
  };
}
