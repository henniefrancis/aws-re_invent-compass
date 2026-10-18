// Type declarations for cli.mjs (foundation-contracts, S0).

export interface CliResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

export declare function applyCli(result: CliResult): void;

export declare function isMain(argv1: string | undefined, metaUrl: string): boolean;

export declare function maybeRunCli(options: {
  runCli: () => Promise<CliResult>;
  argv1: string | undefined;
  metaUrl: string;
}): Promise<boolean>;
