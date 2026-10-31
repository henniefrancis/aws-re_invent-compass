// scan_repo (Requirements 3.7, 4.2, 10.5, P2.1 to P2.4): scans a local folder read-only and reports
// which AWS services it uses and how deeply, then the other technology it uses (languages,
// frameworks, platforms and tools). Only names, depth values, levels, counts, scores and reasoning
// leave the scanner; the folder's file names and contents never do. A dev folder that holds git
// repositories is scanned one repository at a time (task 41). Every project is added to the
// Tech_Profile on this machine (task 42), and the merged result and its taxonomy matches are kept in
// memory for plan_week. A scan never changes where plan_week writes.

import { depthToNumber, mapToTaxonomy, scanRepo as scan } from '@compass/core/scanner';
import type { ScanResult } from '@compass/core/scanner';
import { CompassError } from '../ports/errors.js';
import { isInside } from '../safety/paths.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { sourceFromScan } from '../state/tech-profile.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import {
  findProjects,
  MAX_PROJECTS,
  mergeScanResults,
  PROJECTS_BUDGET_MS,
} from './scan-projects.js';
import { techName } from './show-my-tech.js';

/** The most technologies listed in the reply; show_my_tech lists them all. */
export const TECH_LINES = 15;

/**
 * A folder outside the workspace the server was started in is scanned only after the human
 * confirms it (security M2); a client that cannot ask cannot scan one. A scan never changes where
 * plan_week writes.
 */
async function confirmOutsideWorkspace(
  root: string,
  ctx: ToolContext,
): Promise<{ ok: false; message: string } | undefined> {
  const { scanFs, cwd } = ctx.runtime;
  let workspace = cwd;
  try {
    workspace = await scanFs.realpath(cwd);
  } catch {
    // An unresolvable working directory stays as given, so a folder is judged against what we know.
  }
  if (isInside(root, workspace)) {
    return undefined;
  }
  if (ctx.elicit === undefined) {
    throw new CompassError('ScanOutsideWorkspace');
  }
  const answer = await ctx.elicit({
    message: `Compass will read the folder ${root} to list the AWS services and other technology in it. It only reads; no file name or content is sent anywhere. That folder is outside the workspace Compass was started in. Scan it?`,
  });
  return answer === 'accept'
    ? undefined
    : { ok: false, message: 'Nothing was scanned, because you did not confirm the folder.' };
}

function runScan(root: string, ctx: ToolContext): Promise<ScanResult> {
  const { scanDetectors, scanRunner, scanFs } = ctx.runtime;
  return scanRunner === undefined
    ? scan(root, {
        fs: scanFs,
        ...(scanDetectors === undefined ? {} : { detectors: scanDetectors }),
      })
    : scanRunner(root);
}

interface ProjectScans {
  results: { root: string; result: ScanResult }[];
  overLimit: number;
  outOfTime: number;
  failed: number;
}

/** Scans each project in turn. With one project an error is the tool's; with several it is skipped. */
async function scanProjects(projects: readonly string[], ctx: ToolContext): Promise<ProjectScans> {
  if (projects.length === 1) {
    const [root] = projects as [string];
    return {
      results: [{ root, result: await runScan(root, ctx) }],
      overLimit: 0,
      outOfTime: 0,
      failed: 0,
    };
  }
  const { clock } = ctx.runtime;
  const started = clock.now().getTime();
  const scans: ProjectScans = {
    results: [],
    overLimit: Math.max(0, projects.length - MAX_PROJECTS),
    outOfTime: 0,
    failed: 0,
  };
  for (const root of projects.slice(0, MAX_PROJECTS)) {
    if (clock.now().getTime() - started > PROJECTS_BUDGET_MS) {
      scans.outOfTime += 1;
    } else {
      try {
        scans.results.push({ root, result: await runScan(root, ctx) });
      } catch {
        scans.failed += 1;
      }
    }
  }
  return scans;
}

function projectsLine(projects: number, scans: ProjectScans): string {
  const skipped = [
    scans.overLimit > 0
      ? `${String(scans.overLimit)} over the limit of ${String(MAX_PROJECTS)}`
      : '',
    scans.outOfTime > 0 ? `${String(scans.outOfTime)} not started in time` : '',
    scans.failed > 0 ? `${String(scans.failed)} could not be scanned` : '',
  ].filter((part) => part.length > 0);
  const scanned = `Found ${String(projects)} projects and scanned ${String(scans.results.length)}`;
  return skipped.length === 0 ? `${scanned}.` : `${scanned} (skipped: ${skipped.join(', ')}).`;
}

/** scan_repo. */
export async function scanRepoTool(
  input: { path: string },
  ctx: ToolContext,
): Promise<ToolOutcome<'scan_repo'>> {
  const { scanFs } = ctx.runtime;
  let root: string;
  try {
    root = await scanFs.realpath(input.path);
  } catch {
    throw new CompassError('FolderNotFound');
  }
  const declined = await confirmOutsideWorkspace(root, ctx);
  if (declined !== undefined) {
    return declined;
  }
  const projects = await findProjects(root, scanFs);
  const scans = await scanProjects(projects, ctx);
  if (scans.results.length === 0) {
    return {
      ok: false,
      message: `${projectsLine(projects.length, scans)} Nothing was added to your tech list.`,
    };
  }
  const result = mergeScanResults(scans.results.map((scanned) => scanned.result));
  const scannedAt = ctx.runtime.clock.now().toISOString();
  await ctx.runtime.techProfile.add(
    scans.results.map((scanned) =>
      sourceFromScan('folder', scanned.root, scanned.result, scannedAt),
    ),
  );

  let labels: readonly string[] = [];
  let catalogKnown = true;
  try {
    labels = (await ctx.runtime.events.catalog()).labels;
  } catch (error) {
    if (!(error instanceof CompassError && error.code === 'CatalogMissing')) {
      throw error;
    }
    catalogKnown = false;
  }
  const taxonomy = mapToTaxonomy(result.services, labels);
  ctx.state.lastScan = { result, taxonomy, root };

  const lines: string[] = [];
  if (projects.length > 1) {
    lines.push(projectsLine(projects.length, scans));
  }
  lines.push(`Scanned ${result.filesRead} files and found ${result.services.length} AWS services.`);
  for (const service of result.services) {
    lines.push(
      `- ${service.displayName}: ${service.depth} (depth ${depthToNumber(service.depth)}), suggested level ${String(service.suggestedLevel)}. ${service.reasoning}`,
    );
  }
  if (result.technologies.length > 0) {
    lines.push(`Other technology (${String(result.technologies.length)}), most used first:`);
    for (const tech of result.technologies.slice(0, TECH_LINES)) {
      const { name, group } = techName(tech.key);
      lines.push(`- ${name} (${group}): score ${String(tech.score)}.`);
    }
  }
  lines.push('Added to your tech list on this machine. Ask show_my_tech for all of it.');
  if (!result.pythonAnalysed) {
    lines.push('Python files were not analysed.');
  }
  if (result.truncated) {
    lines.push('The scan stopped at 20,000 files, so some files were not read.');
  }
  if (result.unmappedCount > 0) {
    lines.push(
      `${result.unmappedCount} AWS references did not match a known service and are not listed.`,
    );
  }
  lines.push(
    catalogKnown
      ? 'Catalog service labels that match your services follow.'
      : 'The catalog is not cached yet, so run refresh_catalog to match your services to catalog labels.',
  );
  const names = new Map(result.services.map((s) => [s.key, s.displayName]));
  lines.push(
    labelUntrusted(
      'catalog',
      taxonomy.map((match) => ({
        service: names.get(match.key),
        catalogLabels: match.labels,
        inCatalog: match.inCatalog,
      })),
    ),
  );

  return {
    ok: true,
    structured: {
      services: result.services.map((s) => s.displayName),
      depthByService: result.services.map((s) => ({
        service: s.displayName,
        depth: depthToNumber(s.depth),
      })),
      technologies: result.technologies.map((t) => ({
        technology: techName(t.key).name,
        score: t.score,
      })),
    },
    text: lines.join('\n'),
  };
}
