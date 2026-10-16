// Type declarations for catalog-check.mjs (foundation-contracts, S0), so tests
// that import it are type-safe without disabling any lint rule.

export declare const CATALOG_PATH: string;
export declare const INDEX_PATH: string;

export declare function regenerate(): Promise<{
  catalog: string;
  index: string;
  sessions: unknown[];
}>;

export declare function emit(): Promise<{
  catalogBytes: number;
  indexBytes: number;
  count: number;
}>;

export declare function check(): Promise<{ ok: boolean; problems: string[] }>;
