import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCompassServer } from '../../src/server/create-server.js';
import type { Runtime } from '../../src/ports/runtime.js';
import type { SessionState } from '../../src/state/session-state.js';

/** How the connected client answers elicitation. `undefined` means it does not support it. */
/** `acceptUnticked`, `acceptEmpty` and `acceptText` accept the form but without a ticked box. */
export type ElicitMode =
  'accept' | 'decline' | 'cancel' | 'acceptUnticked' | 'acceptEmpty' | 'acceptText' | undefined;

/** A connected in-memory client and server. */
export interface Connection {
  client: Client;
  server: McpServer;
  /** The messages the server asked through elicitation. */
  questions: string[];
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

/** Connects an in-memory MCP client to `createCompassServer(runtime)`. */
export async function connect(
  runtime: Runtime,
  options: { elicit?: ElicitMode; state?: SessionState } = {},
): Promise<Connection> {
  const server = createCompassServer(runtime, options.state);
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    options.elicit === undefined ? {} : { capabilities: { elicitation: {} } },
  );
  const questions: string[] = [];
  if (options.elicit !== undefined) {
    const action = options.elicit;
    client.setRequestHandler(ElicitRequestSchema, (request) => {
      questions.push(request.params.message);
      switch (action) {
        case 'accept':
          return { action, content: { confirm: true } };
        case 'acceptUnticked':
          return { action: 'accept' as const, content: { confirm: false } };
        case 'acceptEmpty':
          return { action: 'accept' as const };
        case 'acceptText':
          return { action: 'accept' as const, content: { confirm: 'true' } };
        default:
          return { action };
      }
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    server,
    questions,
    call: async (name, args = {}) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** The text of the first text content item of a result. */
export function textOf(result: CallToolResult): string {
  const first = result.content.find((item) => item.type === 'text');
  return first?.type === 'text' ? first.text : '';
}
