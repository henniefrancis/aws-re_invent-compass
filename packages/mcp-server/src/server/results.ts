// Turning a handler outcome into an MCP result (Requirements 8.5 and 17.1). A success
// carries `structuredContent` that is parsed with the tool's contract output schema before
// it is returned (a failure to parse is a bug and becomes a fixed internal error), plus a
// plain-English text and any images. A failure is `isError: true` with text only.

import { mcpTools } from '@compass/contracts';
import type { McpToolName } from '@compass/contracts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { INTERNAL_MESSAGE } from './error-messages.js';
import type { ToolOutcome } from './types.js';

/** The first line of every success in simulated mode, so nothing there reads as real data. */
export const SIMULATED_LABEL = 'SIMULATED MODE: no real data.';

/** A failure result: text only. */
export function failureResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Builds the MCP result for an outcome. */
export function toCallToolResult<K extends McpToolName>(
  name: K,
  outcome: ToolOutcome<K>,
  simulated = false,
): CallToolResult {
  if (!outcome.ok) {
    return failureResult(outcome.message);
  }
  const parsed = mcpTools[name].output.safeParse(outcome.structured);
  if (!parsed.success || outcome.text.trim() === '') {
    return failureResult(INTERNAL_MESSAGE);
  }
  return {
    content: [
      {
        type: 'text',
        text: simulated ? [SIMULATED_LABEL, outcome.text].join('\n') : outcome.text,
      },
      ...(outcome.extra ?? []),
    ],
    structuredContent: parsed.data,
  };
}
