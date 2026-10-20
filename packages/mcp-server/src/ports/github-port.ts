// The GitHub port (compass-power task 45, Requirements P2.8 and P2.9): the read-only GitHub App
// sign-in, the repository list and the scan of one repository. The tools see only this port; the
// live adapter composes `@compass/core/github`, and simulated mode has no GitHub port at all, so
// it can never make a request. Nothing here carries a token.

import type { ScanResult } from '@compass/core/scanner';

/** One repository the GitHub App may read for the attendee. */
export interface GitHubRepositoryRef {
  id: number;
  fullName: string;
  owner: string;
  fork: boolean;
  archived: boolean;
}

/** Where the GitHub sign-in stands. */
export type GitHubConnection =
  | { state: 'notConfigured' }
  | { state: 'disconnected' }
  | { state: 'waiting'; userCode: string; verificationUri: string; expiresAt: string }
  | { state: 'connected' }
  | { state: 'failed'; reason: 'denied' | 'expired' | 'error' };

/** The GitHub side of Compass. */
export interface GitHubPort {
  /** The page where the attendee installs the GitHub App, or undefined when it is not set up. */
  readonly installUrl: string | undefined;
  /** The current state, without a request. */
  status(): GitHubConnection;
  /**
   * Starts the device sign-in (polling runs in the background) and opens the GitHub page. When a
   * sign-in is already waiting or connected, returns that state and starts nothing.
   */
  connect(): Promise<GitHubConnection>;
  /** Every repository the app may read for the attendee. */
  listRepositories(): Promise<GitHubRepositoryRef[]>;
  /** Reads one repository in memory, under the scan budget, and returns the scan result. */
  scanRepository(repository: GitHubRepositoryRef): Promise<ScanResult>;
  /** Deletes the tokens on this machine and stops a waiting sign-in. */
  disconnect(): void;
}
