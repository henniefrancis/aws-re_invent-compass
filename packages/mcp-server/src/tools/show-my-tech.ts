// show_my_tech (compass-power task 43, Requirements P2.5 and P2.10): lists the Tech_Profile kept on
// this machine, AWS services first, then other technology ranked by the number of projects and
// then by score. `top` narrows both lists to the most used. It reads only the local profile.

import { entryFor, techEntryFor } from '@compass/core/scanner';
import { CompassError } from '../ports/errors.js';
import { mergeProfile } from '../state/tech-profile.js';
import type { MergedProfile } from '../state/tech-profile.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';

/** The most rows `top` can ask for. */
export const MAX_TOP = 50;

const DEPTH_NAMES = ['none', 'exploring', 'building', 'production'] as const;

/** The depth name for the contract's depth number. */
export function depthName(depth: number): string {
  return DEPTH_NAMES[depth] ?? 'unknown';
}

/** The display name of an AWS service key. */
export function serviceName(key: string): string {
  return entryFor(key)?.displayName ?? key;
}

/** The display name and group of a technology key. */
export function techName(key: string): { name: string; group: string } {
  const entry = techEntryFor(key);
  return { name: entry?.displayName ?? key, group: entry?.group ?? 'tool' };
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The count line, for example "From 2 folders and 14 GitHub repositories." */
export function sourcesLine(profile: MergedProfile): string {
  return `From ${plural(profile.folders, 'folder', 'folders')} and ${plural(profile.githubRepositories, 'GitHub repository', 'GitHub repositories')}.`;
}

/** show_my_tech. */
export async function showMyTech(
  input: { top?: number | undefined },
  ctx: ToolContext,
): Promise<ToolOutcome<'show_my_tech'>> {
  const { top } = input;
  if (top !== undefined && (!Number.isInteger(top) || top < 1 || top > MAX_TOP)) {
    throw new CompassError('LimitInvalid');
  }
  const profile = mergeProfile((await ctx.runtime.techProfile.read()).sources);
  const services = profile.services.slice(0, top);
  const technologies = profile.technologies.slice(0, top);
  const structured = {
    services: services.map((s) => ({
      service: serviceName(s.key),
      depth: s.depth,
      projects: s.projects,
    })),
    technologies: technologies.map((t) => ({
      technology: techName(t.key).name,
      group: techName(t.key).group,
      projects: t.projects,
      score: t.score,
    })),
    sources: { folders: profile.folders, githubRepositories: profile.githubRepositories },
  };
  if (profile.folders + profile.githubRepositories === 0) {
    return {
      ok: true,
      structured,
      text: 'Compass does not know your tech yet. Run scan_repo on a folder of your code, or connect_github and then scan_github, and ask again.',
    };
  }
  const lines = [sourcesLine(profile)];
  lines.push(services.length === 0 ? 'AWS services: none found yet.' : 'AWS services:');
  for (const s of services) {
    const level = s.level === undefined ? '' : `, suggested level ${String(s.level)}`;
    lines.push(
      `- ${serviceName(s.key)}: ${depthName(s.depth)}${level}, in ${plural(s.projects, 'project', 'projects')}.`,
    );
  }
  lines.push(technologies.length === 0 ? 'Other technology: none found yet.' : 'Other technology:');
  for (const t of technologies) {
    const { name, group } = techName(t.key);
    lines.push(
      `- ${name} (${group}): in ${plural(t.projects, 'project', 'projects')}, score ${String(t.score)}.`,
    );
  }
  lines.push('To find sessions on one of these, use find_sessions_by_tech.');
  return { ok: true, structured, text: lines.join('\n') };
}
