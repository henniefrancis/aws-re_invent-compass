// Type declarations for hash-check.mjs (foundation-contracts, S0), so tests that
// import the scanner are type-safe without disabling any lint rule.

export declare const FILES: string[];

export interface HashEntry {
  file: string;
  sha256: string;
}

export interface HashCheckResult {
  ok: boolean;
  hashes: HashEntry[];
}

export declare function hashCheck(options?: { files?: string[] }): Promise<HashCheckResult>;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export declare function runCli(options?: { files?: string[] }): Promise<CliResult>;
