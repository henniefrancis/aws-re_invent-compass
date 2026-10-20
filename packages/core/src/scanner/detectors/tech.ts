// The Tech_Detectors (compass-power task 41.2; Requirement P2.1).
//
// Each one reads one family of manifests and returns technology declarations, resolved through
// the Tech_Table. A manifest file itself counts one declaration for the technology its name
// points at (`package.json` for Node.js, `App.csproj` for .NET); each declared package the table
// knows counts one more. Read:
//   - `package.json`: the names in `dependencies` and `devDependencies`,
//   - `requirements.txt`: one requirement per line (comments and `-` options skipped),
//   - `pyproject.toml`: the names in any `dependencies = [...]` array and the keys of the
//     `[tool.poetry.dependencies]` (and dev and group) sections, `python` left out,
//   - `Pipfile`: the keys of `[packages]` and `[dev-packages]`,
//   - `*.csproj` and `*.fsproj`: `<PackageReference Include="...">`,
//   - `pom.xml`: every `<artifactId>`; `build.gradle` and `build.gradle.kts`: the artifact of
//     each quoted `group:artifact[:version]` coordinate,
//   - `Gemfile`: `gem 'name'`,
//   - and, by presence only, `go.mod`, `Cargo.toml`, `composer.json`, `global.json`, `*.sln`,
//     `Dockerfile`, the compose files, Helm `Chart.yaml` and `kustomization.yaml`.
// A JSON manifest that does not parse to an object, and an XML project file with no root
// element, count nothing. Text formats are read line by line and a line that cannot be read is
// skipped. Nothing throws, and every pattern is linear (see redos.test.ts).

import { normalisePypi, techForManifest, techForPackage } from '../tech-table.js';
import type { PackageEcosystem, TechKey } from '../tech-table.js';
import { grp } from './text.js';
import type { TechDetector, TechHit } from './types.js';
import { elementTexts, packageReferences } from './xml.js';

const REQUIREMENT_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;
const TOML_KEY = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/;
const TOML_SECTION = /^\[\[?([^\]]*)\]/;
const DEPENDENCY_ARRAY = /^dependencies\s*=\s*\[/;
const QUOTED = /"([^"\n]*)"|'([^'\n]*)'/g;
const GRADLE_COORDINATE = /["']([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::[^"'\n]*)?["']/g;
const GEM = /^gem[\s(]+["']([A-Za-z0-9._-]+)["']/;

/** Adds one declaration of `tech` (when known) to `hits`. */
function addTech(hits: TechHit[], tech: TechKey | undefined): void {
  if (tech === undefined) {
    return;
  }
  const existing = hits.find((hit) => hit.tech === tech);
  if (existing === undefined) {
    hits.push({ tech, kind: 'declarations', count: 1 });
  } else {
    existing.count += 1;
  }
}

/** The one declaration the manifest itself counts for its technology. */
function presence(fileName: string): TechHit[] {
  const hits: TechHit[] = [];
  addTech(hits, techForManifest(fileName));
  return hits;
}

/** The manifest itself plus each declared package of `ecosystem` the table knows. */
function declarations(
  fileName: string,
  ecosystem: PackageEcosystem,
  names: readonly string[],
): TechHit[] {
  const hits = presence(fileName);
  for (const name of names) {
    addTech(hits, techForPackage(ecosystem, name));
  }
  return hits;
}

/** The parsed JSON object, or undefined when the text is not one. */
function jsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The text split into trimmed lines. */
function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim());
}

/** The package name at the start of a requirement string, or undefined. */
function requirementName(requirement: string): string | undefined {
  const match = REQUIREMENT_NAME.exec(requirement);
  return match === null ? undefined : normalisePypi(grp(match, 1));
}

function fromPackageJson(text: string): string[] | undefined {
  const parsed = jsonObject(text);
  if (parsed === undefined) {
    return undefined;
  }
  const names: string[] = [];
  for (const section of ['dependencies', 'devDependencies']) {
    const map = parsed[section];
    if (typeof map === 'object' && map !== null) {
      names.push(...Object.keys(map));
    }
  }
  return names;
}

function fromRequirements(text: string): string[] {
  const names: string[] = [];
  for (const line of lines(text)) {
    const name = line.startsWith('#') || line.startsWith('-') ? undefined : requirementName(line);
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

/** Adds the requirement names of the quoted strings in `rest`; true when the array closes on this line. */
function collectArray(rest: string, names: string[]): boolean {
  for (const match of rest.matchAll(QUOTED)) {
    const name = requirementName(match[1] ?? grp(match, 2));
    if (name !== undefined) {
      names.push(name);
    }
  }
  return rest.replace(QUOTED, '').includes(']');
}

function isPoetryDependencies(section: string): boolean {
  return (
    section === 'tool.poetry.dependencies' ||
    section === 'tool.poetry.dev-dependencies' ||
    (section.startsWith('tool.poetry.group.') && section.endsWith('.dependencies'))
  );
}

/**
 * Reads TOML dependency names line by line: the keys of the sections `keySection` accepts and,
 * when `arrays` is set, the requirement strings of every `dependencies = [...]` array.
 */
function fromToml(
  text: string,
  keySection: (section: string) => boolean,
  arrays: boolean,
): string[] {
  const names: string[] = [];
  let section = '';
  let inArray = false;
  for (const line of lines(text)) {
    if (inArray) {
      inArray = !collectArray(line, names);
      continue;
    }
    const header = TOML_SECTION.exec(line);
    const key = TOML_KEY.exec(line);
    const array = arrays ? DEPENDENCY_ARRAY.exec(line) : null;
    if (header !== null) {
      section = grp(header, 1).trim();
    } else if (keySection(section) && key !== null) {
      const name = normalisePypi(grp(key, 1));
      if (name !== 'python') {
        names.push(name);
      }
    } else if (array !== null) {
      inArray = !collectArray(line.slice(array[0].length), names);
    }
  }
  return names;
}

function fromGradle(text: string): string[] {
  return [...text.matchAll(GRADLE_COORDINATE)].map((match) => grp(match, 2));
}

function fromGemfile(text: string): string[] {
  const names: string[] = [];
  for (const line of lines(text)) {
    const match = GEM.exec(line);
    if (match !== null) {
      names.push(grp(match, 1));
    }
  }
  return names;
}

/** `package.json`: Node.js plus the npm packages the table knows. */
export const nodeTechDetector: TechDetector = {
  id: 'node',
  accepts: (fileName) => fileName === 'package.json',
  detect: (text, fileName) => {
    const names = fromPackageJson(text);
    return names === undefined ? [] : declarations(fileName, 'npm', names);
  },
};

const PYTHON_MANIFESTS: ReadonlySet<string> = new Set([
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
]);

/** `requirements.txt`, `pyproject.toml` and `Pipfile`: Python plus the PyPI packages the table knows. */
export const pythonTechDetector: TechDetector = {
  id: 'python',
  accepts: (fileName) => PYTHON_MANIFESTS.has(fileName),
  detect: (text, fileName) => {
    let names: string[];
    if (fileName === 'requirements.txt') {
      names = fromRequirements(text);
    } else if (fileName === 'pyproject.toml') {
      names = fromToml(text, isPoetryDependencies, true);
    } else {
      names = fromToml(text, (s) => s === 'packages' || s === 'dev-packages', false);
    }
    return declarations(fileName, 'pypi', names);
  },
};

/** `*.csproj` and `*.fsproj`: .NET plus the NuGet packages the table knows. */
export const dotnetTechDetector: TechDetector = {
  id: 'dotnet-projects',
  accepts: (fileName) => fileName.endsWith('.csproj') || fileName.endsWith('.fsproj'),
  detect: (text, fileName) =>
    text.includes('<Project') ? declarations(fileName, 'nuget', packageReferences(text)) : [],
};

/** `pom.xml`, `build.gradle` and `build.gradle.kts`: Java plus the Maven artifacts the table knows. */
export const jvmTechDetector: TechDetector = {
  id: 'jvm',
  accepts: (fileName) =>
    fileName === 'pom.xml' || fileName === 'build.gradle' || fileName === 'build.gradle.kts',
  detect: (text, fileName) => {
    if (fileName !== 'pom.xml') {
      return declarations(fileName, 'maven', fromGradle(text));
    }
    return text.includes('<project')
      ? declarations(fileName, 'maven', elementTexts(text, 'artifactId'))
      : [];
  },
};

/** `Gemfile`: Ruby plus the gems the table knows. */
export const rubyTechDetector: TechDetector = {
  id: 'ruby',
  accepts: (fileName) => fileName === 'Gemfile',
  detect: (text, fileName) => declarations(fileName, 'gems', fromGemfile(text)),
};

const PRESENCE_MANIFESTS: ReadonlySet<string> = new Set([
  'go.mod',
  'Cargo.toml',
  'composer.json',
  'global.json',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'Chart.yaml',
  'kustomization.yaml',
  'kustomization.yml',
]);

/** Manifests counted by presence only; a JSON one must parse to an object. */
export const presenceTechDetector: TechDetector = {
  id: 'presence',
  accepts: (fileName) => PRESENCE_MANIFESTS.has(fileName) || fileName.endsWith('.sln'),
  detect: (text, fileName) =>
    fileName.endsWith('.json') && jsonObject(text) === undefined ? [] : presence(fileName),
};
