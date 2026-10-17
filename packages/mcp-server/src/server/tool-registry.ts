// The tool registry (design, Component 5): one ToolSpec per tool in `mcpTools`, typed so
// that a missing or extra key is a compile error. Classes and annotations follow the design
// table. `sync_passes` is a write tool (CTO review H1) because it can void passes.

import type { McpToolName } from '@compass/contracts';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { checkItinerary } from '../tools/check-itinerary.js';
import { findSessions } from '../tools/find-sessions.js';
import { planWeekTool } from '../tools/plan-week.js';
import { refreshCatalog } from '../tools/refresh-catalog.js';
import { scanRepoTool } from '../tools/scan-repo.js';
import { signIn } from '../tools/sign-in.js';
import { signOut } from '../tools/sign-out.js';
import { DESCRIPTIONS, TITLES } from './descriptions.js';
import type { ToolClass, ToolOutcome, ToolSpec } from './types.js';

/** The message returned by a handler that is not built yet. */
export const NOT_BUILT_MESSAGE = 'This tool is not built yet.';

function notBuilt(): Promise<{ ok: false; message: string }> {
  return Promise.resolve({ ok: false, message: NOT_BUILT_MESSAGE });
}

function spec<K extends McpToolName>(
  name: K,
  toolClass: ToolClass,
  scheduleWrite: boolean,
  handler: ToolSpec<K>['handler'],
): ToolSpec<K> {
  return {
    name,
    class: toolClass,
    scheduleWrite,
    title: TITLES[name],
    description: DESCRIPTIONS[name],
    handler,
  };
}

/** Every tool, keyed by name. Handlers are replaced by the real ones in later tasks. */
export const TOOL_SPECS: { [K in McpToolName]: ToolSpec<K> } = {
  sign_in: spec('sign_in', 'localAction', false, signIn),
  sign_out: spec('sign_out', 'localAction', false, signOut),
  refresh_catalog: spec('refresh_catalog', 'read', false, refreshCatalog),
  find_sessions: spec('find_sessions', 'read', false, findSessions),
  scan_repo: spec('scan_repo', 'read', false, scanRepoTool),
  plan_week: spec('plan_week', 'localAction', false, planWeekTool),
  check_itinerary: spec('check_itinerary', 'read', false, checkItinerary),
  reserve_with_guardrails: spec('reserve_with_guardrails', 'write', true, notBuilt),
  cancel_reservation: spec('cancel_reservation', 'write', true, notBuilt),
  add_standby: spec('add_standby', 'write', true, notBuilt),
  remove_standby: spec('remove_standby', 'write', true, notBuilt),
  add_layover: spec('add_layover', 'write', true, notBuilt),
  issue_boarding_passes: spec('issue_boarding_passes', 'write', false, notBuilt),
  send_to_phone: spec('send_to_phone', 'write', false, notBuilt),
  sync_passes: spec('sync_passes', 'write', false, notBuilt),
  export_calendar: spec('export_calendar', 'localAction', false, notBuilt),
  forget_me: spec('forget_me', 'write', false, notBuilt),
};

/** The MCP annotations for a tool class. */
export function annotationsFor(toolClass: ToolClass, title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: toolClass === 'read',
    destructiveHint: toolClass === 'write',
  };
}

/** The outcome type, re-exported for handlers. */
export type { ToolOutcome };
