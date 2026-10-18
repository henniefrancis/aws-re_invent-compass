// Shared server types (design, Component 5).

import type { McpToolInput, McpToolName, McpToolOutput } from '@compass/contracts';
import type { Runtime } from '../ports/runtime.js';
import type { SessionState } from '../state/session-state.js';

/** How a tool is classified for approval. */
export type ToolClass = 'read' | 'localAction' | 'write';

/** A confirmation question for the human, asked through MCP elicitation. */
export interface ElicitQuestion {
  message: string;
}

/** What a handler gets besides its input. `elicit` exists only when the client supports it. */
export interface ToolContext {
  runtime: Runtime;
  state: SessionState;
  elicit?: (question: ElicitQuestion) => Promise<'accept' | 'decline' | 'cancel'>;
}

/** An image attached to a result (the QR code PNG). */
export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: 'image/png';
}

/** What a handler returns. A failure becomes `isError: true` with text only. */
export type ToolOutcome<K extends McpToolName> =
  | { ok: true; structured: McpToolOutput<K>; text: string; extra?: ImageContent[] }
  | { ok: false; message: string };

/** One registered tool. */
export interface ToolSpec<K extends McpToolName> {
  name: K;
  class: ToolClass;
  /** True when the tool changes the attendee's real re:Invent schedule. */
  scheduleWrite: boolean;
  title: string;
  description: string;
  handler: (input: McpToolInput<K>, ctx: ToolContext) => Promise<ToolOutcome<K>>;
}
