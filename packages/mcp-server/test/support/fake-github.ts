import type { ScanResult } from '@compass/core/scanner';
import type {
  GitHubConnection,
  GitHubPort,
  GitHubRepositoryRef,
} from '../../src/ports/github-port.js';

/** A scan result with one service and one technology, for GitHub repository scans. */
export function repoScan(tech = 'dotnet', service = 's3'): ScanResult {
  return {
    services: [
      {
        key: service,
        displayName: service,
        evidence: {
          terraformResources: 1,
          cdkConstructs: 0,
          cdkImports: 0,
          sdkImports: 0,
          sdkClients: 0,
          sdkCommands: 0,
          boto3Clients: 0,
          dependencyDeclarations: 0,
        },
        depth: 'building',
        suggestedLevel: 300,
        reasoning: 'A resource.',
      },
    ],
    technologies: [
      { key: tech, displayName: tech, group: 'platform', files: 2, declarations: 1, score: 7 },
    ],
    unmappedCount: 0,
    filesRead: 2,
    skipped: {
      excludedDirectory: 0,
      gitignored: 0,
      tooLarge: 0,
      binary: 0,
      symlink: 0,
      unsupportedType: 0,
    },
    truncated: false,
    pythonAnalysed: true,
  };
}

/** A repository reference. */
export function repo(
  fullName: string,
  options: Partial<GitHubRepositoryRef> = {},
): GitHubRepositoryRef {
  const [owner = ''] = fullName.split('/');
  const id = [...fullName].reduce(
    (hash, char) => (hash * 31 + char.charCodeAt(0)) % 1_000_000_007,
    7,
  );
  return { id, fullName, owner, fork: false, archived: false, ...options };
}

/** A recording GitHub port. */
export class FakeGitHub implements GitHubPort {
  installUrl: string | undefined = 'https://github.com/apps/compass-test/installations/new';
  connection: GitHubConnection = { state: 'disconnected' };
  afterConnect: GitHubConnection = {
    state: 'waiting',
    userCode: 'WDJB-MJHT',
    verificationUri: 'https://github.com/login/device',
    expiresAt: '2026-10-20T10:15:00.000Z',
  };
  repositories: GitHubRepositoryRef[] = [];
  /** Per full name: a result, or an error to throw. */
  scans = new Map<string, ScanResult | Error>();
  readonly scanned: string[] = [];
  connects = 0;
  disconnects = 0;
  /** Called before each scan, so a test can move the clock. */
  onScan: (repository: GitHubRepositoryRef) => void = () => undefined;

  status(): GitHubConnection {
    return this.connection;
  }

  connect(): Promise<GitHubConnection> {
    this.connects += 1;
    this.connection = this.afterConnect;
    return Promise.resolve(this.connection);
  }

  listRepositories(): Promise<GitHubRepositoryRef[]> {
    return Promise.resolve([...this.repositories]);
  }

  scanRepository(repository: GitHubRepositoryRef): Promise<ScanResult> {
    this.onScan(repository);
    this.scanned.push(repository.fullName);
    const outcome = this.scans.get(repository.fullName) ?? repoScan();
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }

  disconnect(): void {
    this.disconnects += 1;
    this.connection = { state: 'disconnected' };
  }
}
