// Starts the Compass server on stdio. stdout carries MCP protocol messages only; every log line
// goes to stderr (see the logger). The streams are injectable so the wiring is tested without
// touching the real process streams.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Readable, Writable } from 'node:stream';
import type { Runtime } from '../ports/runtime.js';
import { runStdioServer } from '../server/create-server.js';

/** Connects the server to the given streams and resolves once connected. */
export async function startStdioServer(
  runtime: Runtime,
  stdin: Readable,
  stdout: Writable,
): Promise<void> {
  await runStdioServer(runtime, new StdioServerTransport(stdin, stdout));
}
