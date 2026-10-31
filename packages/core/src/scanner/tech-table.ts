// The Tech_Table (compass-power task 41.2; Requirements P2.1 and P2.6).
//
// One entry per technology that is not an AWS service: a language, a framework, a platform or a
// tool. Each entry names the catalog phrases `find_sessions_by_tech` matches (`searchWords`, matched
// as whole words without regard to case, so a word that is also a common English word, such as
// "Go", "React", "Swift", "Rails" or "Helm" on its own, is left out), the spellings an attendee may type
// (`aliases`), and its signals: file extensions, manifest file names and package names in the
// npm, PyPI, NuGet, Maven (and Gradle) and RubyGems ecosystems.
//
// Matching rules:
//   - An extension is the text from the last `.` of a file name, compared in lower case; a name
//     that starts with its only `.` has none. Each extension belongs to one entry.
//   - A manifest name that starts with `*` matches any file name that ends with the rest
//     (`*.csproj`); any other manifest name matches only that exact name. Each manifest name
//     belongs to one entry.
//   - A package name that ends with `*` matches any name that starts with the rest
//     (`@langchain/*`); any other matches only that exact name. NuGet names are compared without
//     regard to case (as NuGet does) and PyPI names after PEP 503 normalisation, which the PyPI
//     names below are already written in.
//
// The table is sorted by key (a structural test asserts it).

/** A technology key, for example `dotnet`. */
export type TechKey = string;

/** The kind of technology. */
export type TechGroup = 'language' | 'framework' | 'platform' | 'tool';

/** The package ecosystems a manifest can declare. */
export type PackageEcosystem = 'npm' | 'pypi' | 'nuget' | 'maven' | 'gems';

/** One technology and every signal that points at it. */
export interface TechEntry {
  key: TechKey;
  displayName: string;
  group: TechGroup;
  /** Other spellings an attendee may use, in lower case. */
  aliases: string[];
  /** Phrases matched as whole words in session titles, abstracts and topics. */
  searchWords: string[];
  /** File extensions, lower case with the leading `.`. */
  extensions: string[];
  /** Manifest file names; one found counts one declaration. */
  manifestNames: string[];
  npm: string[];
  pypi: string[];
  nuget: string[];
  /** Maven artifact ids, also matched in Gradle dependency coordinates. */
  maven: string[];
  gems: string[];
}

interface Signals {
  aliases?: string[];
  extensions?: string[];
  manifestNames?: string[];
  npm?: string[];
  pypi?: string[];
  nuget?: string[];
  maven?: string[];
  gems?: string[];
}

/** Builds an entry with empty lists for the signals it does not have. */
function tech(
  key: TechKey,
  displayName: string,
  group: TechGroup,
  searchWords: string[],
  signals: Signals,
): TechEntry {
  return {
    key,
    displayName,
    group,
    aliases: signals.aliases ?? [],
    searchWords,
    extensions: signals.extensions ?? [],
    manifestNames: signals.manifestNames ?? [],
    npm: signals.npm ?? [],
    pypi: signals.pypi ?? [],
    nuget: signals.nuget ?? [],
    maven: signals.maven ?? [],
    gems: signals.gems ?? [],
  };
}

/** The technology table, sorted by key. */
export const TECH_TABLE: readonly TechEntry[] = [
  tech('angular', 'Angular', 'framework', ['Angular'], {
    aliases: ['angularjs'],
    npm: ['@angular/core'],
  }),
  tech('aspnet', 'ASP.NET Core', 'framework', ['ASP.NET', 'ASP.NET Core'], {
    aliases: ['asp.net', 'asp.net core', 'aspnetcore', 'aspnet core'],
    nuget: ['Microsoft.AspNetCore.*'],
  }),
  tech('csharp', 'C#', 'language', ['C#'], {
    aliases: ['c#', 'csharp', 'c sharp'],
    extensions: ['.cs', '.csx'],
  }),
  tech('django', 'Django', 'framework', ['Django'], { pypi: ['django'] }),
  tech('docker', 'Docker', 'tool', ['Docker', 'Dockerfile', 'Docker Compose'], {
    aliases: ['dockerfile', 'docker compose'],
    manifestNames: [
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
    ],
  }),
  tech('dotnet', '.NET', 'platform', ['.NET', 'dotnet', '.NET Core'], {
    aliases: ['.net', 'dotnet', 'net core', '.net core', '.net framework'],
    manifestNames: ['*.csproj', '*.fsproj', '*.sln', 'global.json'],
  }),
  tech('express', 'Express', 'framework', ['Express.js', 'ExpressJS'], {
    aliases: ['express.js', 'expressjs'],
    npm: ['express'],
  }),
  tech('fastapi', 'FastAPI', 'framework', ['FastAPI'], { pypi: ['fastapi'] }),
  tech('flask', 'Flask', 'framework', ['Flask'], { pypi: ['flask'] }),
  tech('fsharp', 'F#', 'language', ['F#'], {
    aliases: ['f#', 'fsharp', 'f sharp'],
    extensions: ['.fs', '.fsi', '.fsx'],
  }),
  tech('go', 'Go', 'language', ['Golang', 'Go language'], {
    aliases: ['golang', 'go lang'],
    extensions: ['.go'],
    manifestNames: ['go.mod'],
  }),
  tech('graphql', 'GraphQL', 'tool', ['GraphQL'], {
    aliases: ['gql'],
    extensions: ['.graphql', '.gql'],
    npm: ['graphql'],
    pypi: ['graphql-core', 'graphene', 'strawberry-graphql'],
    nuget: ['GraphQL', 'HotChocolate.*'],
    maven: ['graphql-java'],
    gems: ['graphql'],
  }),
  tech('java', 'Java', 'language', ['Java', 'Amazon Corretto', 'Corretto'], {
    aliases: ['jdk', 'jvm'],
    extensions: ['.java'],
    manifestNames: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  }),
  tech('javascript', 'JavaScript', 'language', ['JavaScript', 'ECMAScript'], {
    aliases: ['js', 'ecmascript'],
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  }),
  tech('kotlin', 'Kotlin', 'language', ['Kotlin'], {
    aliases: ['kt'],
    extensions: ['.kt', '.kts'],
    maven: ['kotlin-stdlib*'],
  }),
  tech(
    'kubernetes',
    'Kubernetes',
    'platform',
    ['Kubernetes', 'K8s', 'Helm chart', 'Helm charts', 'Kustomize'],
    {
      aliases: ['k8s', 'helm', 'kustomize'],
      manifestNames: ['Chart.yaml', 'kustomization.yaml', 'kustomization.yml'],
    },
  ),
  tech('langchain', 'LangChain', 'framework', ['LangChain', 'LangGraph'], {
    aliases: ['langgraph'],
    npm: ['langchain', '@langchain/*'],
    pypi: ['langchain', 'langchain-*', 'langgraph'],
  }),
  tech('nestjs', 'NestJS', 'framework', ['NestJS', 'Nest.js'], {
    aliases: ['nest.js', 'nest'],
    npm: ['@nestjs/core'],
  }),
  tech('nextjs', 'Next.js', 'framework', ['Next.js', 'NextJS'], {
    aliases: ['nextjs', 'next'],
    npm: ['next'],
  }),
  tech('nodejs', 'Node.js', 'platform', ['Node.js', 'NodeJS'], {
    aliases: ['node', 'nodejs'],
    manifestNames: ['package.json'],
  }),
  tech('php', 'PHP', 'language', ['PHP', 'Laravel'], {
    extensions: ['.php'],
    manifestNames: ['composer.json'],
  }),
  tech('python', 'Python', 'language', ['Python'], {
    aliases: ['py', 'python3'],
    extensions: ['.py', '.pyi'],
    manifestNames: ['requirements.txt', 'pyproject.toml', 'Pipfile'],
  }),
  tech('pytorch', 'PyTorch', 'framework', ['PyTorch'], {
    aliases: ['torch'],
    pypi: ['torch'],
  }),
  tech('rails', 'Ruby on Rails', 'framework', ['Ruby on Rails'], {
    aliases: ['rails', 'ror'],
    gems: ['rails'],
  }),
  tech('react', 'React', 'framework', ['React.js', 'ReactJS', 'React Native', 'React app'], {
    aliases: ['reactjs', 'react.js', 'react native'],
    npm: ['react', 'react-native'],
  }),
  tech('ruby', 'Ruby', 'language', ['Ruby'], {
    extensions: ['.rb'],
    manifestNames: ['Gemfile'],
  }),
  tech('rust', 'Rust', 'language', ['Rust', 'Rustlang'], {
    aliases: ['rustlang'],
    extensions: ['.rs'],
    manifestNames: ['Cargo.toml'],
  }),
  tech('spring', 'Spring Boot', 'framework', ['Spring Boot', 'Spring Framework', 'Spring Cloud'], {
    aliases: ['spring', 'springboot', 'spring framework'],
    maven: ['spring-boot*'],
  }),
  tech('swift', 'Swift', 'language', ['SwiftUI', 'Swift language', 'server-side Swift'], {
    aliases: ['swiftui'],
    extensions: ['.swift'],
  }),
  tech('tensorflow', 'TensorFlow', 'framework', ['TensorFlow'], {
    pypi: ['tensorflow', 'tensorflow-*'],
    npm: ['@tensorflow/*'],
  }),
  tech('terraform', 'Terraform', 'tool', ['Terraform'], {
    aliases: ['tf', 'hcl'],
    extensions: ['.tf', '.tfvars'],
  }),
  tech('typescript', 'TypeScript', 'language', ['TypeScript'], {
    aliases: ['ts'],
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    npm: ['typescript'],
  }),
  tech('vue', 'Vue.js', 'framework', ['Vue.js', 'Vue', 'VueJS'], {
    aliases: ['vue', 'vuejs'],
    extensions: ['.vue'],
    npm: ['vue'],
  }),
];

/** PEP 503 normalisation: lower case, runs of `-`, `_` and `.` become one `-`. */
export function normalisePypi(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** Compares a name in its ecosystem's way (see the matching rules above). */
function canonical(ecosystem: PackageEcosystem, name: string): string {
  if (ecosystem === 'nuget') {
    return name.toLowerCase();
  }
  return ecosystem === 'pypi' ? normalisePypi(name) : name;
}

interface PackageIndex {
  exact: Map<string, TechKey>;
  prefixes: (readonly [string, TechKey])[];
}

interface Indexes {
  names: Map<string, TechKey>;
  extensions: Map<string, TechKey>;
  manifests: Map<string, TechKey>;
  manifestSuffixes: (readonly [string, TechKey])[];
  packages: Record<PackageEcosystem, PackageIndex>;
}

const ECOSYSTEMS: readonly PackageEcosystem[] = ['npm', 'pypi', 'nuget', 'maven', 'gems'];

function buildIndexes(): Indexes {
  const indexes: Indexes = {
    names: new Map(),
    extensions: new Map(),
    manifests: new Map(),
    manifestSuffixes: [],
    packages: {
      npm: { exact: new Map(), prefixes: [] },
      pypi: { exact: new Map(), prefixes: [] },
      nuget: { exact: new Map(), prefixes: [] },
      maven: { exact: new Map(), prefixes: [] },
      gems: { exact: new Map(), prefixes: [] },
    },
  };
  for (const entry of TECH_TABLE) {
    for (const name of [entry.key, entry.displayName, ...entry.aliases]) {
      indexes.names.set(name.toLowerCase(), entry.key);
    }
    for (const extension of entry.extensions) indexes.extensions.set(extension, entry.key);
    for (const manifest of entry.manifestNames) {
      if (manifest.startsWith('*')) {
        indexes.manifestSuffixes.push([manifest.slice(1), entry.key]);
      } else {
        indexes.manifests.set(manifest, entry.key);
      }
    }
    for (const ecosystem of ECOSYSTEMS) {
      const index = indexes.packages[ecosystem];
      for (const name of entry[ecosystem]) {
        const id = canonical(ecosystem, name);
        if (id.endsWith('*')) {
          index.prefixes.push([id.slice(0, -1), entry.key]);
        } else {
          index.exact.set(id, entry.key);
        }
      }
    }
  }
  return indexes;
}

const INDEXES = buildIndexes();

/** Looks an entry up by key. */
export function techEntryFor(key: TechKey): TechEntry | undefined {
  return TECH_TABLE.find((entry) => entry.key === key);
}

/** Resolves a key, display name or alias (any case, trimmed) to its entry, for example ".NET". */
export function resolveTech(name: string): TechEntry | undefined {
  const key = INDEXES.names.get(name.trim().toLowerCase());
  return key === undefined ? undefined : techEntryFor(key);
}

/** The technology a file name's extension points at, if any. */
export function techForExtension(fileName: string): TechKey | undefined {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? INDEXES.extensions.get(fileName.slice(dot).toLowerCase()) : undefined;
}

/** The technology a manifest file name points at, if any (`package.json`, `App.csproj`). */
export function techForManifest(fileName: string): TechKey | undefined {
  const exact = INDEXES.manifests.get(fileName);
  if (exact !== undefined) {
    return exact;
  }
  return INDEXES.manifestSuffixes.find(([suffix]) => fileName.endsWith(suffix))?.[1];
}

/** The technology a declared package points at, if any. */
export function techForPackage(ecosystem: PackageEcosystem, name: string): TechKey | undefined {
  const index = INDEXES.packages[ecosystem];
  const id = canonical(ecosystem, name);
  return index.exact.get(id) ?? index.prefixes.find(([prefix]) => id.startsWith(prefix))?.[1];
}
