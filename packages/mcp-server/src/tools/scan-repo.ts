// scan_repo (Requirements 3.7, 4.2, 10.5): scans a local folder read-only and reports which AWS
// services it uses and how deeply. Only service names, depth values, levels, counts and
// reasoning leave the scanner; the folder's file names and contents never do. The full result
// and the taxonomy matches are kept in memory for plan_week, and the scanned folder becomes the
// Workspace_Root.

import { depthToNumber, mapToTaxonomy, scanRepo as scan } from '@compass/core/scanner';
import { CompassError } from '../ports/errors.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';

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
  const { scanDetectors } = ctx.runtime;
  const result = await scan(root, {
    fs: scanFs,
    ...(scanDetectors === undefined ? {} : { detectors: scanDetectors }),
  });

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
