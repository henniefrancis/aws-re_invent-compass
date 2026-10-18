// Tool identity for the hooks (Requirement 19.6, CTO review M5). The tool name comes from the
// `tool_name` field and may be a bare name (`reserve_with_guardrails`) or carry a server prefix
// (`mcp_power-reinvent-compass-compass_reserve_with_guardrails`, `mcp_awsevents_ReserveSessions`).
// A Power tool call arrives as `kiro_powers` and is unwrapped first (hook-input.ts, ADR-024).
// Matching is case-insensitive and needs a non-alphanumeric character (or the start) before the
// tool name, so any server prefix resolves and a longer, different name does not. This is the one
// place that knows the names; an SP1 result changes this file, the exit policy and the template.

import { mcpTools } from '@compass/contracts';
import type { McpToolName } from '@compass/contracts';

/** The write tools of the official remote server. */
export const AWSEVENTS_WRITE_TOOLS = [
  'ReserveSessions',
  'CancelReservation',
  'AssociateFavorites',
  'DisassociateFavorite',
  'CreatePersonalTime',
  'UpdatePersonalTime',
  'DeletePersonalTime',
] as const;

/** One of the seven Awsevents_Write_Tools. */
export type AwseventsWriteTool = (typeof AWSEVENTS_WRITE_TOOLS)[number];

/** The Compass tools that change the attendee's real schedule. */
export const SCHEDULE_WRITE_TOOLS = [
  'reserve_with_guardrails',
  'cancel_reservation',
  'add_standby',
  'remove_standby',
  'add_layover',
] as const satisfies readonly McpToolName[];

/** Every Compass Write_Tool (CTO review H1 adds sync_passes). */
export const COMPASS_WRITE_TOOLS = [
  ...SCHEDULE_WRITE_TOOLS,
  'issue_boarding_passes',
  'send_to_phone',
  'sync_passes',
  'forget_me',
] as const satisfies readonly McpToolName[];

/** Who owns a tool name. */
export type ToolIdentity =
  | { server: 'compass'; tool: McpToolName }
  | { server: 'awsevents'; tool: AwseventsWriteTool }
  | { server: 'unknown' };

const KNOWN: readonly ToolIdentity[] = [
  ...(Object.keys(mcpTools) as McpToolName[]).map((tool): ToolIdentity => ({
    server: 'compass',
    tool,
  })),
  ...AWSEVENTS_WRITE_TOOLS.map((tool): ToolIdentity => ({ server: 'awsevents', tool })),
];

const nameOf = (identity: ToolIdentity): string =>
  identity.server === 'unknown' ? '' : identity.tool.toLowerCase();

/** Resolves a `tool_name` to a known tool, whatever the server prefix. */
export function identifyTool(toolName: string): ToolIdentity {
  const lowered = toolName.toLowerCase();
  let best: ToolIdentity = { server: 'unknown' };
  for (const identity of KNOWN) {
    const name = nameOf(identity);
    const boundary =
      lowered.length === name.length ||
      !/[a-z0-9]/.test(lowered.charAt(lowered.length - name.length - 1));
    if (lowered.endsWith(name) && boundary && name.length > nameOf(best).length) {
      best = identity;
    }
  }
  return best;
}
