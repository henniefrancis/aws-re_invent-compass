// The week spec renderer (design, Component 3; Requirement 6). Pure and deterministic:
// the same input gives byte-identical files.
//
// Every string that came from the catalog (and every other string a person or a service
// supplied) passes through `sanitiseCatalogText`, so it appears as one double-quoted line
// of data and can never start a heading, a task or a link. Nothing from the scan except
// service display names and depth is included, and no file names, paths or contents.

import type { PlanResult } from './planner.js';
import { eventDay } from './planner.js';

/** How comfortable the walk into a session is (mirrors the server's ConnectionLine). */
export interface ConnectionLine {
  classification: 'comfortable' | 'tight' | 'impossible' | 'unknown';
  walkingMinutes?: number;
  reason: string;
}

/** The energy result for one day (mirrors the server's EnergyLine). */
export interface EnergyLine {
  overloaded: boolean;
  explanation: string;
}

/** Everything the renderer needs. */
export interface WeekSpecInput {
  plan: PlanResult;
  /** Keyed by the pick's session id: the walk into it. */
  connections: ReadonlyMap<string, ConnectionLine>;
  /** Keyed by the event-local day (`YYYY-MM-DD`). */
  energyByDay: ReadonlyMap<string, EnergyLine>;
  scanSummary: readonly {
    displayName: string;
    depth: 'none' | 'exploring' | 'building' | 'production';
  }[];
  goals: readonly string[];
  eventWindow: { start: string; end: string; timezone: string };
  /** From the injected clock. */
  generatedAt: string;
}

/** The three Week_Spec documents. */
export interface WeekSpecFiles {
  requirementsMd: string;
  designMd: string;
  tasksMd: string;
}

const CONTROLS = new RegExp(
  `[${['\\u0000-\\u001f', '\\u007f-\\u009f', '\\u2028\\u2029'].join('')}]`,
  'g',
);
const INVISIBLES = new RegExp(
  '[\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]',
  'g',
);
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`, 'g');
const MARKDOWN = /[\\`*_[\]<>#|"]/g;

/** One line, no control or invisible characters, Markdown escaped, dashes as hyphens. No quotes. */
function escapeLine(value: string): string {
  return value
    .replace(INVISIBLES, '')
    .replace(CONTROLS, ' ')
    .replace(DASHES, '-')
    .replace(/ {2,}/g, ' ')
    .trim()
    .replace(MARKDOWN, '\\$&');
}

/** Renders catalog text as a single line of quoted data. */
export function sanitiseCatalogText(value: string): string {
  return `"${escapeLine(value)}"`;
}

function partValue(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts
    .filter((part) => part.type === type)
    .map((part) => part.value)
    .join('');
}

/** An event-local time such as `Tue 1 Dec 10:30`. */
export function formatLocal(instant: string, timezone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    return 'unknown time';
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): string => partValue(parts, type);
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('hour')}:${get('minute')}`;
}

function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(Date.UTC(Number(year), Number(month) - 1, Number(date), 12)));
  const get = (type: string): string => partValue(parts, type);
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

function minusMinutes(instant: string, minutes: number): string {
  return new Date(Date.parse(instant) - minutes * 60000).toISOString();
}

const DEPTH_WORDS = {
  none: 'not used',
  exploring: 'exploring',
  building: 'building',
  production: 'production',
} as const;

function renderRequirements(input: WeekSpecInput): string {
  const lines = [
    '# Requirements: my re:Invent week',
    '',
    '## Introduction',
    '',
    'This is a suggested week of AWS re:Invent sessions, made by Compass from your code and your goals. It is a plan, not a booking: nothing is reserved until you approve each step in `tasks.md`.',
    '',
    '## Requirements',
    '',
    '1. WHEN a reserved session is on my itinerary, I SHALL be at its gate before boarding closes, which is 10 minutes before the session starts.',
    '2. WHILE a day has sessions over lunch, my itinerary SHALL keep a 30 minute layover between 11:30 and 14:00.',
  ];
  let number = 3;
  for (const service of input.scanSummary) {
    lines.push(
      `${number}. WHEN a session covers ${sanitiseCatalogText(service.displayName)}, THE itinerary SHALL prefer it, because my code uses it at the ${DEPTH_WORDS[service.depth]} depth.`,
    );
    number += 1;
  }
  for (const goal of input.goals) {
    lines.push(
      `${number}. WHEN I look for sessions, THE itinerary SHALL favour my goal ${sanitiseCatalogText(goal)}.`,
    );
    number += 1;
  }
  return `${lines.join('\n')}\n`;
}

function renderDesign(input: WeekSpecInput): string {
  const { plan, eventWindow } = input;
  const zone = eventWindow.timezone;
  const lines = [
    '# Design: my re:Invent week',
    '',
    `All times are in ${zone.replace(/[^A-Za-z0-9_+/-]/g, '')}.`,
    '',
    `Generated on ${formatLocal(input.generatedAt, zone)}.`,
    '',
    '## Scan summary',
    '',
  ];
  if (input.scanSummary.length === 0) {
    lines.push('- No AWS services were found in your code.');
  }
  for (const service of input.scanSummary) {
    lines.push(`- ${sanitiseCatalogText(service.displayName)}: ${DEPTH_WORDS[service.depth]}`);
  }
  lines.push('');
  if (plan.excludedForMissingTimes > 0) {
    lines.push(
      `${plan.excludedForMissingTimes} sessions were left out because their times are missing.`,
      '',
    );
  }

  const picksByDay = new Map<string, typeof plan.picks>();
  for (const pick of plan.picks) {
    const day = eventDay(String(pick.session.startsAt), zone);
    picksByDay.set(day, [...(picksByDay.get(day) ?? []), pick]);
  }
  const days = [...new Set([...picksByDay.keys(), ...plan.layovers.map((l) => l.day)])].sort();
  if (days.length === 0) {
    lines.push('No sessions were planned.', '');
  }
  for (const day of days) {
    const picks = picksByDay.get(day) ?? [];
    lines.push(`## ${formatDay(day)}`, '');
    picks.forEach((pick, index) => {
      const s = pick.session;
      const start = String(s.startsAt);
      const end = String(s.endsAt);
      const gate =
        s.venue === undefined
          ? 'Venue not published'
          : s.room === undefined
            ? sanitiseCatalogText(s.venue)
            : `${sanitiseCatalogText(s.venue)}, ${sanitiseCatalogText(s.room)}`;
      lines.push(
        `### Pick ${index + 1}: ${sanitiseCatalogText(s.code)}`,
        '',
        `- Title: ${sanitiseCatalogText(s.title)}`,
        `- Type: ${s.type === undefined ? 'unknown' : sanitiseCatalogText(s.type)}`,
        `- Level: ${s.level === undefined ? 'unknown' : sanitiseCatalogText(s.level)}`,
        `- Gate: ${gate}`,
        `- Times: ${formatLocal(start, zone)} to ${formatLocal(end, zone)}`,
        `- Boarding closes: ${formatLocal(minusMinutes(start, 10), zone)}`,
        `- Why: ${sanitiseCatalogText(pick.reason)}`,
      );
      const connection = input.connections.get(s.sessionId);
      lines.push(
        connection === undefined
          ? '- Connection: no walk to check'
          : `- Connection: ${connection.classification}${connection.walkingMinutes === undefined ? '' : `, ${connection.walkingMinutes} minutes of walking`}, ${sanitiseCatalogText(connection.reason)}`,
      );
      lines.push(
        pick.walkUp
          ? '- Reservation: walk up, no reservation needed'
          : '- Reservation: reserve this session',
      );
      if (pick.standby !== undefined) {
        lines.push(
          `- Standby: ${sanitiseCatalogText(pick.standby.session.code)} on ${formatLocal(String(pick.standby.session.startsAt), zone)}, ${sanitiseCatalogText(pick.standby.reason)}`,
        );
      }
      lines.push('');
    });
    for (const layover of plan.layovers.filter((l) => l.day === day)) {
      lines.push(
        `- Layover: ${formatLocal(layover.start, zone)} to ${formatLocal(layover.end, zone)}, ${sanitiseCatalogText(layover.reason)}`,
      );
    }
    const energy = input.energyByDay.get(day);
    lines.push(
      energy === undefined
        ? `- Energy: ${picks.length} sessions planned`
        : `- Energy: ${energy.overloaded ? 'overloaded' : 'manageable'}, ${sanitiseCatalogText(energy.explanation)}`,
      '',
    );
  }
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

function renderTasks(input: WeekSpecInput): string {
  const zone = input.eventWindow.timezone;
  const actions: string[] = [];
  for (const pick of input.plan.picks) {
    if (!pick.walkUp) {
      actions.push(
        `Reserve ${sanitiseCatalogText(pick.session.code)} (session id ${sanitiseCatalogText(pick.session.sessionId)}) with \`reserve_with_guardrails\``,
      );
    }
  }
  for (const pick of input.plan.picks) {
    if (pick.standby !== undefined) {
      actions.push(
        `Add ${sanitiseCatalogText(pick.standby.session.code)} (session id ${sanitiseCatalogText(pick.standby.session.sessionId)}) to standby with \`add_standby\``,
      );
    }
  }
  for (const layover of input.plan.layovers) {
    actions.push(
      `Add the layover on ${formatLocal(layover.start, zone)} to ${formatLocal(layover.end, zone)} with \`add_layover\``,
    );
  }
  actions.push('Issue Boarding Passes with `issue_all_boarding_passes`');
  const lines = [
    '# Tasks: my re:Invent week',
    '',
    'Each task changes your real re:Invent schedule or passes, so you approve it first. Run `check_itinerary` before you approve a booking.',
    '',
    ...actions.map((action, index) => `- [ ] ${index + 1}. ${action}`),
  ];
  return `${lines.join('\n')}\n`;
}

/** Renders the three Week_Spec documents. */
export function renderWeekSpec(input: WeekSpecInput): WeekSpecFiles {
  return {
    requirementsMd: renderRequirements(input),
    designMd: renderDesign(input),
    tasksMd: renderTasks(input),
  };
}
