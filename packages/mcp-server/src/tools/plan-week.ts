// plan_week (Requirements 5.3, 7.1 to 7.6, 10.1; CTO review M3): suggests a week from the last
// scan, the goals and the confirmed schedule, writes it as a Kiro spec in the workspace, and
// offers to keep it out of a public repository. It never calls an Events API write.
//
// Writing to disk: the text states the absolute target folder, and where the client declares
// elicitation the human confirms that folder first (decline or cancel writes nothing). The
// `.gitignore` entry is added only on an explicit accept; without elicitation the offer, the
// reason and the exact line are returned as text and nothing changes.

import { depthToNumber } from '@compass/core/scanner';
import {
  addWeekSpecToGitignore,
  eventDay,
  isWeekSpecIgnored,
  PartialWriteError,
  planWeek,
  renderWeekSpec,
  SpecWriteRefusedError,
  trimDiff,
  WEEK_SPEC_ENTRY,
  weekSpecDirectory,
  writeWeekSpec,
} from '@compass/core/spec';
import type { PlannerFinding, PlannerRules, WeekSpecFiles, WriteOutcome } from '@compass/core/spec';
import { CompassError } from '../ports/errors.js';
import type { CatalogView } from '../ports/events-port.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import type { ConnectionLine } from '../ports/rules-port.js';
import {
  commitmentFor,
  confirmedCommitments,
  ensureSignedIn,
  readFreshSchedule,
} from './common.js';

/** The default and the largest number of sessions planned on one day. */
export const DEFAULT_MAX_PER_DAY = 4;
const MAX_PER_DAY_LIMIT = 8;

/** The most goals accepted (security L6). */
export const MAX_GOALS = 20;

/** The session levels a plan can be tuned to (QA low: level is validated). */
const LEVELS: ReadonlySet<string> = new Set(['100', '200', '300', '400']);

/** The reason shown with the gitignore offer. */
export const GITIGNORE_REASON =
  'If this repository is public, the plan would publish where you will be and when.';

/** plan_week input. */
export interface PlanWeekInput {
  goals?: string[] | undefined;
  level?: string | undefined;
  maxPerDay?: number | undefined;
}

function bindRules(
  ctx: ToolContext,
  catalog: CatalogView,
  favorites: readonly string[],
): PlannerRules {
  const { rules } = ctx.runtime;
  return {
    checkReservation: (candidate, commitments) =>
      rules.checkReservation(candidate, commitments, catalog),
    suggestLayovers: async (day) => (await rules.suggestLayovers(day, catalog)).suggestions,
    repeatsOf: async (session) =>
      (await rules.rebooking(session.code, catalog, favorites, session.sessionId))
        .filter((option) => option.kind === 'repeat')
        .map((option) => option.session),
    connectionRisk: async (candidate, commitments) => {
      const bad = (line: ConnectionLine | undefined): boolean =>
        line !== undefined &&
        (line.classification === 'impossible' || line.classification === 'unknown');
      const before = await rules.connections(commitments, catalog);
      const after = await rules.connections([...commitments, commitmentFor(candidate)], catalog);
      // A risk is a bad walk that the candidate creates: one that was not there before.
      return [...after].some(([id, line]) => bad(line) && !bad(before.get(id)));
    },
  };
}

function findingsFrom(ctx: ToolContext): PlannerFinding[] {
  const scan = ctx.state.lastScan;
  if (scan === undefined) {
    return [];
  }
  const matches = new Map(scan.taxonomy.map((match) => [match.key, match]));
  return scan.result.services.flatMap((service) => {
    const match = matches.get(service.key);
    return match === undefined
      ? []
      : [
          {
            displayName: service.displayName,
            depth: depthToNumber(service.depth),
            ...(service.suggestedLevel === undefined ? {} : { level: service.suggestedLevel }),
            labels: match.labels,
          },
        ];
  });
}

async function offerGitignore(root: string, ctx: ToolContext): Promise<string> {
  const { specFs } = ctx.runtime;
  if (await isWeekSpecIgnored(root, specFs)) {
    return 'Your .gitignore already keeps the plan out of version control.';
  }
  const offer = `Add ${WEEK_SPEC_ENTRY} to .gitignore? ${GITIGNORE_REASON}`;
  if (ctx.elicit === undefined) {
    return `${offer} Compass did not change .gitignore. To do it yourself, add this exact line:\n${WEEK_SPEC_ENTRY}`;
  }
  const answer = await ctx.elicit({ message: offer });
  if (answer !== 'accept') {
    return `Compass did not change .gitignore. ${GITIGNORE_REASON} To do it yourself, add this exact line:\n${WEEK_SPEC_ENTRY}`;
  }
  try {
    const result = await addWeekSpecToGitignore(root, specFs);
    return result === 'added'
      ? `Added ${WEEK_SPEC_ENTRY} to .gitignore.`
      : 'Your .gitignore already lists the plan folder.';
  } catch (error) {
    if (error instanceof SpecWriteRefusedError) {
      return 'Compass did not change .gitignore because it cannot be written safely.';
    }
    throw error;
  }
}

function describeWrite(outcome: WriteOutcome, directory: string): string {
  if (outcome.kind === 'created') {
    return `Created requirements.md, design.md and tasks.md in ${directory}.`;
  }
  if (outcome.kind === 'unchanged') {
    return `A plan already exists in ${directory} and the new plan has no differences from it, so Compass wrote nothing.`;
  }
  const changes = trimDiff(outcome.diff);
  return [
    `A plan already exists in ${directory}, so Compass left it unchanged and wrote ${outcome.fileName} instead.`,
    `Changes from the existing plan, with a few lines of context${outcome.diff.truncated ? ' (shortened)' : ''}:`,
    labelUntrusted('catalog', changes.lines),
  ].join('\n');
}

/**
 * Writes the plan and then, last, the `.gitignore` offer, and reports exactly what happened (QA M5).
 * A write that stops part way says which files exist and which do not, and leaves `.gitignore`
 * alone. A `.gitignore` that cannot be read or changed safely never hides that the plan was written.
 */
async function writeAndReport(
  root: string,
  files: WeekSpecFiles,
  ctx: ToolContext,
  directory: string,
  timezone: string,
): Promise<string[]> {
  const { runtime } = ctx;
  let outcome: WriteOutcome;
  try {
    outcome = await writeWeekSpec(root, files, {
      fs: runtime.specFs,
      today: eventDay(runtime.clock.now().toISOString(), timezone),
    });
  } catch (error) {
    if (error instanceof PartialWriteError) {
      return [
        `Compass could not finish writing the plan in ${directory}.`,
        `It wrote: ${error.written.join(', ')}.`,
        `It did not write: ${error.missing.join(', ')}.`,
        'It did not touch .gitignore. Check the folder, then run plan_week again; existing files are never overwritten.',
      ];
    }
    throw error;
  }
  const lines = [describeWrite(outcome, directory)];
  try {
    lines.push(await offerGitignore(root, ctx));
  } catch {
    lines.push('Compass could not read or change .gitignore safely, so it left it as it was.');
  }
  return lines;
}

/** plan_week. */
export async function planWeekTool(
  input: PlanWeekInput,
  ctx: ToolContext,
): Promise<ToolOutcome<'plan_week'>> {
  const maxPerDay = input.maxPerDay ?? DEFAULT_MAX_PER_DAY;
  if (!Number.isInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > MAX_PER_DAY_LIMIT) {
    throw new CompassError('MaxPerDayRange');
  }
  if ((input.goals ?? []).length > MAX_GOALS) {
    throw new CompassError('InputTooLarge');
  }
  if (input.level !== undefined && !LEVELS.has(input.level.trim())) {
    throw new CompassError('LevelInvalid');
  }
  await ensureSignedIn(ctx);
  const { runtime, state } = ctx;
  const catalog = await runtime.events.catalog();
  const { schedule, window } = await readFreshSchedule(ctx);
  const confirmed = confirmedCommitments(schedule, catalog);
  const findings = findingsFrom(ctx);
  const goals = input.goals ?? [];

  const plan = await planWeek(
    {
      sessions: [...catalog.byId.values()],
      confirmed,
      findings,
      goals,
      ...(input.level === undefined ? {} : { level: input.level }),
      maxPerDay,
      eventWindow: window,
    },
    bindRules(ctx, catalog, schedule.favorites),
  );

  const all = [...confirmed, ...plan.commitments];
  const files = renderWeekSpec({
    plan,
    connections: await runtime.rules.connections(all, catalog),
    energyByDay: await runtime.rules.energy(all, catalog),
    scanSummary: (state.lastScan?.result.services ?? []).map((s) => ({
      displayName: s.displayName,
      depth: s.depth,
    })),
    goals,
    eventWindow: window,
    generatedAt: runtime.clock.now().toISOString(),
  });

  // The plan is only ever written to the folder the server was started in. A scan of another folder
  // never moves it (security M2).
  const root = runtime.cwd;
  const directory = weekSpecDirectory(root);
  const lines = [
    `Planned ${plan.picks.length} sessions and ${plan.layovers.length} layovers. Nothing has been booked.`,
  ];
  if (findings.length === 0 && goals.length === 0) {
    lines.push('Run scan_repo first, or give goals, so the plan can match your work.');
  }
  if (plan.excludedForMissingTimes > 0) {
    lines.push(
      `${plan.excludedForMissingTimes} sessions were left out because their times are missing.`,
    );
  }
  lines.push(`The plan will be written to ${directory}.`);
  if (ctx.elicit === undefined) {
    // The plan_week contract has no confirmWrite argument, so a client that cannot ask gets the plan
    // written, only ever to the folder the server was started in, and the text says so.
    lines.push(
      'This client cannot ask for confirmation, so Compass writes only to the folder it was started in. It never overwrites a file.',
    );
  }

  const confirmedFolder =
    ctx.elicit === undefined
      ? 'accept'
      : await ctx.elicit({
          message: `Compass will write your week plan to ${directory}. Write it there?`,
        });
  if (confirmedFolder === 'accept') {
    lines.push(...(await writeAndReport(root, files, ctx, directory, window.timezone)));
  } else {
    lines.push('Nothing was written, because you did not confirm the folder.');
  }

  lines.push(
    'The planned sessions follow.',
    labelUntrusted(
      'catalog',
      plan.picks.map((pick) => ({
        sessionId: pick.session.sessionId,
        code: pick.session.code,
        title: pick.session.title,
        startsAt: pick.session.startsAt,
        endsAt: pick.session.endsAt,
        reason: pick.reason,
        walkUp: pick.walkUp,
        standby: pick.standby?.session.code,
      })),
    ),
  );
  return { ok: true, structured: { commitments: plan.commitments }, text: lines.join('\n') };
}
