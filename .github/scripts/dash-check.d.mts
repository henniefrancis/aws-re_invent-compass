// Type declarations for dash-check.mjs (foundation-contracts, S0), so tests that
// import the scanner are type-safe without disabling any lint rule.

export declare const EXCLUDED: Set<string>;

export interface DashFinding {
  file: string;
  line: number;
  column: number;
  kind: string;
}

export interface ScanFinding {
  line: number;
  column: number;
  kind: string;
}

export interface DashCheckResult {
  ok: boolean;
  findings: DashFinding[];
}

export declare function listTrackedFiles(cwd?: string): string[];

export declare function scanText(text: string): ScanFinding[];

export declare function dashCheck(options?: { cwd?: string; files?: string[] }): DashCheckResult;
