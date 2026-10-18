// An in-memory MCP client for the demo: it talks to `createCompassServer` through a linked pair of
// transports, so the demo runs the real tools end to end with no process and no socket. It
// declares elicitation and accepts every confirmation, because the demo only ever runs against
// the Simulated_Runtime and every confirmation concerns simulated data.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Runtime } from '../ports/runtime.js';
import { createCompassServer } from '../server/create-server.js';

/** A connected client. */
export interface DemoClient {
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

/** Connects a client to a fresh server built over `runtime`. */
export async function connectDemoClient(runtime: Runtime): Promise<DemoClient> {
  const server = createCompassServer(runtime);
  const client = new Client(
    { name: 'reinvent-compass-demo', version: '1.0.0' },
    {
      capabilities: { elicitation: {} },
    },
  );
  client.setRequestHandler(ElicitRequestSchema, () => ({
    action: 'accept' as const,
    content: { confirm: true },
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    call: async (name, args) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
