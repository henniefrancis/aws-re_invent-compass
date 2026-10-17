// The Compass server (Requirements 8.1 to 8.8, design Component 5).
//
// `createCompassServer` registers exactly the tools keyed in `mcpTools`, passing each
// entry's contract input and output schema through unchanged. It reads nothing at
// initialisation (no catalog, network or keychain), so cold start stays fast. Every handler
// call is wrapped: a throw becomes a fixed plain-English message, logged by code only. The
// `elicit` capability is offered to a handler only when the connected client declares
// elicitation.

import { mcpTools } from '@compass/contracts';
import type { McpToolInput, McpToolName } from '@compass/contracts';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createSwapLedger } from '../guardrail/swap-ledger.js';
import type { Runtime } from '../ports/runtime.js';
import { createSessionState } from '../state/session-state.js';
import type { SessionState } from '../state/session-state.js';
import { codeFor, messageFor } from './error-messages.js';
import { createMutex } from './mutex.js';
import type { Mutex } from './mutex.js';
import { registrationSchema } from './output-schema.js';
import { failureResult, toCallToolResult } from './results.js';
import { TOOL_SPECS, annotationsFor } from './tool-registry.js';
import type { ElicitQuestion, ToolContext } from './types.js';

function register<K extends McpToolName>(
  server: McpServer,
  runtime: Runtime,
  state: SessionState,
  writeLock: Mutex,
  name: K,
): void {
  const spec = TOOL_SPECS[name];
  server.registerTool(
    name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: mcpTools[name].input,
      outputSchema: registrationSchema(mcpTools[name].output),
      annotations: annotationsFor(spec.class, spec.title),
    },
    async (args: unknown): Promise<CallToolResult> => {
      const ctx: ToolContext = { runtime, state };
      if (server.server.getClientCapabilities()?.elicitation !== undefined) {
        ctx.elicit = async (question: ElicitQuestion) => {
          try {
            const answer = await server.server.elicitInput({
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
            // Only a ticked box is a yes (QA M1, security L2): an accepted form with confirm missing,
            // false or not a boolean true counts as a decline.
            return answer.action === 'accept' && answer.content?.confirm !== true
              ? 'decline'
              : answer.action;
          } catch {
            // A form the client could not answer properly (an invalid answer, a closed
            // connection) is not a yes, so no write follows.
            return 'cancel';
          }
        };
      }
      try {
        const input = mcpTools[name].input.parse(args) as McpToolInput<K>;
        // Write tools run one at a time; each re-reads the schedule when it gets its turn.
        const outcome =
          spec.class === 'write'
            ? await writeLock.run(() => spec.handler(input, ctx))
            : await spec.handler(input, ctx);
        return toCallToolResult(name, outcome, runtime.mode === 'simulated');
      } catch (error) {
        runtime.logger.warn('tool failed', { tool: name, code: codeFor(error) });
        return failureResult(messageFor(error));
      }
    },
  );
}

/** Builds the server with every tool registered. Reads nothing. */
export function createCompassServer(
  runtime: Runtime,
  state: SessionState = createSessionState(createSwapLedger(runtime.clock)),
): McpServer {
  const server = new McpServer({ name: 'reinvent-compass', version: runtime.version });
  const writeLock = createMutex();
  for (const name of Object.keys(mcpTools) as McpToolName[]) {
    register(server, runtime, state, writeLock, name);
  }
  return server;
}

/** Connects the server to a transport (stdio in production). Resolves once connected. */
export async function runStdioServer(runtime: Runtime, transport: Transport): Promise<McpServer> {
  const server = createCompassServer(runtime);
  await server.connect(transport);
  return server;
}
