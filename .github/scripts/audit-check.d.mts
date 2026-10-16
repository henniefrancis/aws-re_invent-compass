// Type declarations for audit-check.mjs (foundation-contracts, S0).

export declare const ALLOWLIST: string[];

export interface Advisory {
  id: string;
  severity: string;
  title: string;
}

export interface AuditRunnerResult {
  stdout: string | null | undefined;
  error?: Error | null;
  status?: number | null;
}

export declare function resolveNpmCommand(
  env: Record<string, string | undefined>,
  execPath: string,
): { command: string; args: string[] };

export declare function runAudit(runner?: () => AuditRunnerResult): unknown;

export declare function extractAdvisories(report: unknown): Advisory[];

export declare function evaluate(report: unknown): {
  ok: boolean;
  blocking: Advisory[];
  allowlisted: string[];
};

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export declare function runCli(options?: { runner?: () => AuditRunnerResult }): Promise<CliResult>;
