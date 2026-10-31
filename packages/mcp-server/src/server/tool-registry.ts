// The tool registry (design, Component 5): one ToolSpec per tool in `mcpTools`, typed so
// that a missing or extra key is a compile error. Classes and annotations follow the design
// table. `sync_passes` is a write tool (CTO review H1) because it can void passes.

import type { McpToolName } from '@compass/contracts';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { addLayover } from '../tools/add-layover.js';
import { addStandby } from '../tools/add-standby.js';
import { cancelReservation } from '../tools/cancel-reservation.js';
import { checkItinerary } from '../tools/check-itinerary.js';
import { exportCalendar } from '../tools/export-calendar.js';
import { findSessions } from '../tools/find-sessions.js';
import { findSessionsByTech } from '../tools/find-sessions-by-tech.js';
import { forgetMe } from '../tools/forget-me.js';
import { connectGithub, disconnectGithub, scanGithub } from '../tools/github.js';
import { issueAllBoardingPasses, issueBoardingPass } from '../tools/issue-boarding-passes.js';
import { planWeekTool } from '../tools/plan-week.js';
import { refreshCatalog } from '../tools/refresh-catalog.js';
import { removeStandby } from '../tools/remove-standby.js';
import { reserveWithGuardrails } from '../tools/reserve-with-guardrails.js';
import { scanRepoTool } from '../tools/scan-repo.js';
import { sendToPhone } from '../tools/send-to-phone.js';
import { showMyTech } from '../tools/show-my-tech.js';
import { showSchedule } from '../tools/show-schedule.js';
import { signIn } from '../tools/sign-in.js';
import { signOut } from '../tools/sign-out.js';
import { syncPasses } from '../tools/sync-passes.js';
import { DESCRIPTIONS, TITLES } from './descriptions.js';
import type { ToolClass, ToolOutcome, ToolSpec } from './types.js';

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

/** Every tool, keyed by name. */
export const TOOL_SPECS: { [K in McpToolName]: ToolSpec<K> } = {
  sign_in: spec('sign_in', 'localAction', false, signIn),
  sign_out: spec('sign_out', 'localAction', false, signOut),
  refresh_catalog: spec('refresh_catalog', 'read', false, refreshCatalog),
  find_sessions: spec('find_sessions', 'read', false, findSessions),
  scan_repo: spec('scan_repo', 'read', false, scanRepoTool),
  plan_week: spec('plan_week', 'localAction', false, planWeekTool),
  check_itinerary: spec('check_itinerary', 'read', false, checkItinerary),
  show_schedule: spec('show_schedule', 'read', false, showSchedule),
  reserve_with_guardrails: spec('reserve_with_guardrails', 'write', true, reserveWithGuardrails),
  cancel_reservation: spec('cancel_reservation', 'write', true, cancelReservation),
  add_standby: spec('add_standby', 'write', true, addStandby),
  remove_standby: spec('remove_standby', 'write', true, removeStandby),
  add_layover: spec('add_layover', 'write', true, addLayover),
  issue_all_boarding_passes: spec(
    'issue_all_boarding_passes',
    'write',
    false,
    issueAllBoardingPasses,
  ),
  issue_boarding_pass: spec('issue_boarding_pass', 'write', false, issueBoardingPass),
  send_to_phone: spec('send_to_phone', 'write', false, sendToPhone),
  sync_passes: spec('sync_passes', 'write', false, syncPasses),
  export_calendar: spec('export_calendar', 'localAction', false, exportCalendar),
  forget_me: spec('forget_me', 'write', false, forgetMe),
  show_my_tech: spec('show_my_tech', 'read', false, showMyTech),
  find_sessions_by_tech: spec('find_sessions_by_tech', 'read', false, findSessionsByTech),
  connect_github: spec('connect_github', 'localAction', false, connectGithub),
  scan_github: spec('scan_github', 'read', false, scanGithub),
  disconnect_github: spec('disconnect_github', 'localAction', false, disconnectGithub),
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
