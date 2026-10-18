// The hook input (Requirement 19.6). Kiro passes one JSON object on stdin with at least
// `tool_name` and `tool_input`. Unknown fields are stripped. Anything that does not parse is
// "malformed" and the hook fails open. No input value is ever placed on a command line.

import { z } from 'zod';

/** The fields the hooks read. */
export const HookInputSchema = z.object({
  hook_event_name: z.string().optional(),
  tool_name: z.string(),
  tool_input: z.unknown().optional(),
  cwd: z.string().optional(),
  session_id: z.string().optional(),
});

/** A parsed hook input. */
export type HookInput = z.infer<typeof HookInputSchema>;

/** Parses the raw stdin text, or returns undefined when it is not a usable hook input. */
export function parseHookInput(raw: string): HookInput | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = HookInputSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/** The one built-in tool Kiro routes every Power tool call through (ADR-024, SP1). */
export const KIRO_POWERS_TOOL = 'kiro_powers';

// The server names a Power's tools can carry: the name in mcp.json, or the name Kiro registers
// for a folder import (`power-<folder>-<server>`, for example `power-power-compass`).
const COMPASS_SERVER = /^(?:power-[a-z0-9-]+-)?compass$/i;
const AWSEVENTS_SERVER = /^(?:power-[a-z0-9-]+-)?awsevents$/i;

/** The tool a hook should judge: its name and the arguments it was called with. */
export interface HookCall {
  toolName: string;
  toolInput: unknown;
}

/**
 * Finds the real tool call in a hook input. A direct tool name (`mcp_<server>_<tool>` or a bare
 * name) is returned as given. A `kiro_powers` call is unwrapped only when its action is `use`
 * and its server is Compass or the official awsevents server: the tool is `tool_input.toolName`
 * and its arguments are `tool_input.arguments`. Activation, other powers and anything malformed
 * give `'ignore'`. `powerName` is never read, because it is the import folder's name.
 */
export function unwrapPowerCall(input: HookInput): HookCall | 'ignore' {
  if (input.tool_name.toLowerCase() !== KIRO_POWERS_TOOL) {
    return { toolName: input.tool_name, toolInput: input.tool_input };
  }
  const wrapped = input.tool_input;
  if (typeof wrapped !== 'object' || wrapped === null) {
    return 'ignore';
  }
  const { action, serverName, toolName, arguments: args } = wrapped as Record<string, unknown>;
  if (
    action !== 'use' ||
    typeof serverName !== 'string' ||
    typeof toolName !== 'string' ||
    !(COMPASS_SERVER.test(serverName) || AWSEVENTS_SERVER.test(serverName))
  ) {
    return 'ignore';
  }
  return { toolName, toolInput: args };
}
