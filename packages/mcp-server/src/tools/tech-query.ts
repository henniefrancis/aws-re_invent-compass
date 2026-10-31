// From a technology or an AWS service to the catalog sessions about it (compass-power task 44,
// Requirement P2.6), shared by find_sessions_by_tech and plan_week. A technology is searched by the
// Tech_Table's search words; an AWS service by its display name, its short name ("S3" for
// "Amazon S3") and the catalog service labels its taxonomy maps to. Every word matches as a whole
// word (see adapters/word-match.ts).

import type { NormalisedSession } from '@compass/contracts';
import {
  entryFor,
  mapToTaxonomy,
  resolveTech,
  SERVICE_TABLE,
  techEntryFor,
} from '@compass/core/scanner';
import type { CatalogView } from '../ports/events-port.js';

/** What to search for one technology or service. */
export interface TechQuery {
  /** The name shown to the attendee. */
  label: string;
  words: string[];
  /** Catalog `services` labels that also count as a match. */
  serviceLabels: string[];
}

const VENDOR_PREFIX = /^(Amazon|AWS)\s+/;

/** The search for one Tech_Table key. */
export function queryForTechKey(key: string): TechQuery {
  const entry = techEntryFor(key);
  return entry === undefined
    ? { label: key, words: [key], serviceLabels: [] }
    : { label: entry.displayName, words: [...entry.searchWords], serviceLabels: [] };
}

/** The search for one Service_Table key. */
export function queryForServiceKey(key: string, catalog: CatalogView): TechQuery {
  const name = entryFor(key)?.displayName ?? key;
  const short = name.replace(VENDOR_PREFIX, '');
  return {
    label: name,
    words: [...new Set([name, short])],
    serviceLabels: mapToTaxonomy([{ key }], catalog.labels).flatMap((match) => match.labels),
  };
}

/** The search for what the attendee typed: a technology, an AWS service, or one literal word. */
export function queryForInput(input: string, catalog: CatalogView): TechQuery {
  const wanted = input.trim();
  const tech = resolveTech(wanted);
  if (tech !== undefined) {
    return queryForTechKey(tech.key);
  }
  const lower = wanted.toLowerCase();
  const service = SERVICE_TABLE.find(
    (entry) =>
      entry.key === lower ||
      entry.displayName.toLowerCase() === lower ||
      entry.displayName.replace(VENDOR_PREFIX, '').toLowerCase() === lower,
  );
  return service === undefined
    ? { label: wanted, words: [wanted], serviceLabels: [] }
    : queryForServiceKey(service.key, catalog);
}

/** The cached sessions that match a query, in catalog order. */
export function sessionsFor(catalog: CatalogView, query: TechQuery): NormalisedSession[] {
  const ids = new Set(catalog.filter({ words: query.words }).map((s) => s.sessionId));
  if (query.serviceLabels.length > 0) {
    for (const session of catalog.filter({ services: query.serviceLabels })) {
      ids.add(session.sessionId);
    }
  }
  return catalog.filter({}).filter((session) => ids.has(session.sessionId));
}
