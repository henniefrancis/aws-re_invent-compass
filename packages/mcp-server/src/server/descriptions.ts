// Tool descriptions (Requirement 8.3). Each starts with the plain purpose. Every
// Write_Tool says the real change it makes, and every tool that changes the attendee's
// schedule says so in a fixed sentence.

import type { McpToolName } from '@compass/contracts';

/** The sentence every schedule-changing tool ends with. */
export const SCHEDULE_WRITE_SENTENCE =
  'This changes your real re:Invent schedule. Compass checks it first and asks you to approve it.';

/** The sentence for tools that create boarding passes. */
export const ISSUE_SENTENCE = 'This creates real boarding passes on the Compass pass service.';

/** The sentence for the phone hand-off. */
export const HANDOFF_SENTENCE = 'This creates a real 15-minute link to your passes.';

/** The sentence for the pass sync, which can void passes. */
export const SYNC_SENTENCE =
  'This can void boarding passes on the Compass pass service that no longer match your schedule.';

/** The sentence for forget_me. */
export const FORGET_SENTENCE = 'This really deletes your passes and local Compass data.';

/** The description of each tool. */
export const DESCRIPTIONS: Record<McpToolName, string> = {
  sign_in: 'Sign in to the AWS Events service with your AWS Builder ID in the browser.',
  sign_out: 'Sign out of the AWS Events service and forget the sign-in held in memory.',
  refresh_catalog: 'Download the session catalog into the local cache so it can be searched.',
  find_sessions:
    'Search the cached session catalog by words, service, level, type or day. Nothing is changed.',
  scan_repo:
    'Scan a local folder read-only and report which AWS services it uses and how deeply. Only service names and depth leave the scanner.',
  plan_week:
    'Suggest a week of sessions from your code and goals, and write it as a Kiro spec in your workspace. It does not book anything.',
  check_itinerary:
    'Check a proposed itinerary against the booking guardrail and report clashes and tight walks. Nothing is changed.',
  reserve_with_guardrails: `Reserve one to ten sessions after the booking guardrail passes. ${SCHEDULE_WRITE_SENTENCE}`,
  cancel_reservation: `Cancel one reservation, safely swapping to a repeat when one is planned. ${SCHEDULE_WRITE_SENTENCE}`,
  add_standby: `Add one to ten sessions to your standby list as backups. ${SCHEDULE_WRITE_SENTENCE}`,
  remove_standby: `Remove one session from your standby list. ${SCHEDULE_WRITE_SENTENCE}`,
  add_layover: `Create, change or delete a layover, a block of your own time for a meal or rest (action create, update or delete). ${SCHEDULE_WRITE_SENTENCE}`,
  issue_boarding_passes: `Issue unofficial boarding passes for your reserved sessions. ${ISSUE_SENTENCE}`,
  send_to_phone: `Open a short-lived link and QR code that puts your passes on your phone. ${HANDOFF_SENTENCE}`,
  sync_passes: `Bring your boarding passes in line with your confirmed schedule. ${SYNC_SENTENCE}`,
  export_calendar: 'Build a calendar file for your itinerary. Nothing is booked.',
  forget_me: `Delete everything Compass holds about you. ${FORGET_SENTENCE}`,
};

/** A short title for each tool. */
export const TITLES: Record<McpToolName, string> = {
  sign_in: 'Sign in',
  sign_out: 'Sign out',
  refresh_catalog: 'Refresh the catalog',
  find_sessions: 'Find sessions',
  scan_repo: 'Scan a repository',
  plan_week: 'Plan my week',
  check_itinerary: 'Check my itinerary',
  reserve_with_guardrails: 'Reserve with guardrails',
  cancel_reservation: 'Cancel a reservation',
  add_standby: 'Add standby',
  remove_standby: 'Remove standby',
  add_layover: 'Add a layover',
  issue_boarding_passes: 'Issue boarding passes',
  send_to_phone: 'Send passes to my phone',
  sync_passes: 'Sync boarding passes',
  export_calendar: 'Export a calendar',
  forget_me: 'Forget me',
};
