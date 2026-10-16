// Type declarations for gen-copy.mjs (foundation-contracts, S0), so tests that
// import it are type-safe without disabling any lint rule.

export declare const SOURCE: string;
export declare const COPIES: string[];

export declare function genCopy(options?: {
  source?: string;
  copies?: string[];
}): Promise<{ source: string; copies: string[]; bytes: number }>;
