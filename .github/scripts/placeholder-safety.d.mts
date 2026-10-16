// Type declarations for placeholder-safety.mjs (foundation-contracts, S0), so
// tests that import the scanner are type-safe without disabling any lint rule.

export declare const FILES: string[];

export interface PlaceholderFinding {
  file: string;
  line: number;
  column: number;
  pattern: string;
}

export interface PlaceholderSafetyResult {
  ok: boolean;
  findings: PlaceholderFinding[];
}

export declare function placeholderSafety(options?: {
  files?: string[];
}): Promise<PlaceholderSafetyResult>;
