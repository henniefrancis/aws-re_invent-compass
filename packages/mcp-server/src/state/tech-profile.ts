// The Tech_Profile (compass-power task 42, Requirements P2.2 and P2.4): every project Compass has
// scanned, as AWS service and technology keys with counts, kept on the attendee's machine in the
// OS app-data folder beside the Schedule_Snapshot (file mode 0o600, folder mode 0o700, a
// `simulated` subfolder in simulated mode, atomic write through the production file system
// adapter). A project is keyed by a SHA-256 of its folder or repository, so no path or name is
// ever stored. A project scanned again replaces its entry; at most MAX_SOURCES are kept, the
// oldest dropped first. A file that cannot be read or parsed, or that holds a key Compass does not
// know, reads as an empty profile. The ids are unsalted hashes of the attendee's own folder paths
// and repository ids: someone who already has this file could test a guess, which is accepted
// because the file stays on the attendee's machine with mode 0600 (security review L1).

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ScanResult } from '@compass/core/scanner';
import { depthToNumber, entryFor, techEntryFor } from '@compass/core/scanner';
import type { FileSystem } from '@compass/core/passes';
import { z } from 'zod';

/** The most projects kept. */
export const MAX_SOURCES = 500;

/** The profile file name. */
export const TECH_PROFILE_FILE_NAME = 'tech-profile.json';

/** Where a project came from. */
export type SourceKind = 'folder' | 'github';

/** One AWS service in one project. */
export interface ProfileService {
  key: string;
  /** 0 to 3, as `depthToNumber`. */
  depth: number;
  level?: number;
  score: number;
}

/** One technology in one project. */
export interface ProfileTechnology {
  key: string;
  files: number;
  declarations: number;
  score: number;
}

/** One scanned project. */
export interface ProfileSource {
  id: string;
  kind: SourceKind;
  scannedAt: string;
  services: ProfileService[];
  technologies: ProfileTechnology[];
}

/** What is written to disk. */
export interface TechProfile {
  version: 1;
  mode: 'live' | 'simulated';
  sources: ProfileSource[];
}

/** Reads and changes the profile. */
export interface TechProfileStore {
  read(): Promise<TechProfile>;
  /** Adds the sources, each replacing an earlier one with the same id. */
  add(sources: readonly ProfileSource[]): Promise<TechProfile>;
  remove(): Promise<void>;
}

const count = z.number().int().nonnegative();

/** The most services or technologies one project can hold in the file. */
const MAX_KEYS = 200;

// Only keys of the Service_Table and the Tech_Table are accepted, so text planted in the file by
// other software can never reach the model (security review M2).
const serviceKey = z.string().refine((key) => entryFor(key) !== undefined);
const techKey = z.string().refine((key) => techEntryFor(key) !== undefined);

const TechProfileSchema = z.object({
  version: z.literal(1),
  mode: z.enum(['live', 'simulated']),
  sources: z
    .array(
      z.object({
        id: z.string().regex(/^[0-9a-f]{64}$/),
        kind: z.enum(['folder', 'github']),
        scannedAt: z.iso.datetime(),
        services: z
          .array(
            z.object({
              key: serviceKey,
              depth: z.number().int().min(0).max(3),
              level: z.number().int().min(100).max(400).optional(),
              score: count,
            }),
          )
          .max(MAX_KEYS),
        technologies: z
          .array(z.object({ key: techKey, files: count, declarations: count, score: count }))
          .max(MAX_KEYS),
      }),
    )
    .max(MAX_SOURCES),
});

/** The one-way id of a project: no path or repository name is kept. */
export function sourceId(kind: SourceKind, identity: string): string {
  return createHash('sha256').update(`${kind}:${identity}`).digest('hex');
}

/** Turns one scan result into a profile source. */
export function sourceFromScan(
  kind: SourceKind,
  identity: string,
  result: ScanResult,
  scannedAt: string,
): ProfileSource {
  return {
    id: sourceId(kind, identity),
    kind,
    scannedAt,
    services: result.services.map((service) => ({
      key: service.key,
      depth: depthToNumber(service.depth),
      ...(service.suggestedLevel === undefined ? {} : { level: service.suggestedLevel }),
      score: Object.values(service.evidence).reduce((sum, value) => sum + value, 0),
    })),
    technologies: result.technologies.map((tech) => ({
      key: tech.key,
      files: tech.files,
      declarations: tech.declarations,
      score: tech.score,
    })),
  };
}

/** Adds `added` to `existing`: same ids replaced, newest last, at most MAX_SOURCES. */
export function addSources(
  existing: readonly ProfileSource[],
  added: readonly ProfileSource[],
): ProfileSource[] {
  const ids = new Set(added.map((source) => source.id));
  const merged = [...existing.filter((source) => !ids.has(source.id)), ...added];
  return merged.slice(Math.max(0, merged.length - MAX_SOURCES));
}

/** Creates the store under `appDataDir` (or its `simulated` subfolder). */
export function createTechProfileStore(
  appDataDir: string,
  mode: 'live' | 'simulated',
  fs: FileSystem,
  processId = 0,
): TechProfileStore {
  const directory = mode === 'simulated' ? join(appDataDir, 'simulated') : appDataDir;
  const file = join(directory, TECH_PROFILE_FILE_NAME);
  const empty = (): TechProfile => ({ version: 1, mode, sources: [] });

  const read = async (): Promise<TechProfile> => {
    let raw: unknown;
    try {
      // A missing file reads as null, and a file that cannot be read or parsed is empty too.
      raw = JSON.parse((await fs.readFile(file)) ?? 'null');
    } catch {
      return empty();
    }
    const parsed = TechProfileSchema.safeParse(raw);
    return parsed.success && parsed.data.mode === mode ? parsed.data : empty();
  };

  const write = async (sources: readonly ProfileSource[]): Promise<TechProfile> => {
    const profile: TechProfile = {
      version: 1,
      mode,
      sources: addSources((await read()).sources, sources),
    };
    const temporary = `${file}.${processId}.tmp`;
    await fs.ensureDir(directory, 0o700);
    await fs.writeFile(temporary, JSON.stringify(profile), 0o600);
    await fs.rename(temporary, file);
    return profile;
  };

  // One change at a time, so two scans that finish together never lose a write (security review L7).
  let queue: Promise<unknown> = Promise.resolve();
  const serialised = <T>(step: () => Promise<T>): Promise<T> => {
    const next = queue.then(step, step);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    read,
    add: (sources) => serialised(() => write(sources)),
    remove: () => serialised(() => fs.remove(file)),
  };
}

/** An AWS service across the profile. */
export interface MergedService {
  key: string;
  depth: number;
  level?: number;
  projects: number;
  score: number;
}

/** A technology across the profile. */
export interface MergedTechnology {
  key: string;
  projects: number;
  score: number;
}

/** The whole profile, merged and ranked. */
export interface MergedProfile {
  services: MergedService[];
  technologies: MergedTechnology[];
  folders: number;
  githubRepositories: number;
}

// Keys are unique within a merged list, so two keys are never equal.
function byKey(a: { key: string }, b: { key: string }): number {
  return a.key < b.key ? -1 : 1;
}

/**
 * Merges every source. A service takes its deepest depth (and that depth's highest level); a
 * technology sums its score. Services rank by depth, then projects, then score; technology by
 * projects, then score. Ties go by key, so the order never depends on the order of the sources.
 */
export function mergeProfile(sources: readonly ProfileSource[]): MergedProfile {
  const services = new Map<string, MergedService>();
  const technologies = new Map<string, MergedTechnology>();
  for (const source of sources) {
    for (const service of source.services) {
      const seen = services.get(service.key);
      const deeper = seen === undefined || service.depth > seen.depth;
      const sameDepthHigherLevel =
        seen !== undefined &&
        service.depth === seen.depth &&
        (service.level ?? 0) > (seen.level ?? 0);
      const level = deeper || sameDepthHigherLevel ? service.level : seen?.level;
      services.set(service.key, {
        key: service.key,
        depth: Math.max(service.depth, seen?.depth ?? 0),
        ...(level === undefined ? {} : { level }),
        projects: (seen?.projects ?? 0) + 1,
        score: (seen?.score ?? 0) + service.score,
      });
    }
    for (const tech of source.technologies) {
      const seen = technologies.get(tech.key);
      technologies.set(tech.key, {
        key: tech.key,
        projects: (seen?.projects ?? 0) + 1,
        score: (seen?.score ?? 0) + tech.score,
      });
    }
  }
  return {
    services: [...services.values()].sort(
      (a, b) => b.depth - a.depth || b.projects - a.projects || b.score - a.score || byKey(a, b),
    ),
    technologies: [...technologies.values()].sort(
      (a, b) => b.projects - a.projects || b.score - a.score || byKey(a, b),
    ),
    folders: sources.filter((source) => source.kind === 'folder').length,
    githubRepositories: sources.filter((source) => source.kind === 'github').length,
  };
}
