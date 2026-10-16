// Type declarations for gen-types.mjs (foundation-contracts, S0), so tests that
// import it are type-safe without disabling any lint rule.

export interface GenTypesTarget {
  input: string;
  output: string;
}

export declare const TARGETS: GenTypesTarget[];

export declare function genTypes(options?: { targets?: GenTypesTarget[] }): Promise<string[]>;
