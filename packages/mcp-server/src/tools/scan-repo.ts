// scan_repo (Requirements 3.7, 4.2, 10.5): scans a local folder read-only and reports which AWS
// services it uses and how deeply. Only service names, depth values, levels, counts and
// reasoning leave the scanner; the folder's file names and contents never do. The full result
// and the taxonomy matches are kept in memory for plan_week, and the scanned folder becomes the
// Workspace_Root.

import { depthToNumber, mapToTaxonomy, scanRepo as scan } from '@compass/core/scanner';
import { CompassError } from '../ports/errors.js';
import { isInside } from '../safety/paths.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';

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
    message: `Compass will read the folder ${root} to count the AWS services in it. It only reads; no file name or content is sent anywhere. That folder is outside the workspace Compass was started in. Scan it?`,
  });
  return answer === 'accept'
    ? undefined
    : { ok: false, message: 'Nothing was scanned, because you did not confirm the folder.' };
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
  const { scanDetectors, scanRunner } = ctx.runtime;
  const result =
    scanRunner === undefined
      ? await scan(root, {
          fs: scanFs,
          ...(scanDetectors === undefined ? {} : { detectors: scanDetectors }),
        })
      : await scanRunner(root);

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

  const lines = [
    `Scanned ${result.filesRead} files and found ${result.services.length} AWS services.`,
  ];
  for (const service of result.services) {
    lines.push(
      `- ${service.displayName}: ${service.depth} (depth ${depthToNumber(service.depth)}), suggested level ${String(service.suggestedLevel)}. ${service.reasoning}`,
    );
  }
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
    },
    text: lines.join('\n'),
  };
}
