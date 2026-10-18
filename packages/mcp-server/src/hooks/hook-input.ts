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
