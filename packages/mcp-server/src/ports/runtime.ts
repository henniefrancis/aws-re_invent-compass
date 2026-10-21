// The Runtime: everything a handler may touch, built once at start-up (design,
// Architecture, Runtime and ports). createRuntime(env) picks live or simulated; tests
// pass fakes. Nothing in a handler imports another stream directly.

import type { Detector, ScanResult } from '@compass/core/scanner';
import type { Clock } from './clock.js';
import type { EventsPort } from './events-port.js';
import type { ScanFs, SpecFs } from './fs-ports.js';
import type { Logger } from './logger.js';
import type { PassesPort } from './passes-port.js';
import type { RulesPort } from './rules-port.js';
import type { SnapshotStore } from '../state/schedule-snapshot.js';
import type { TechProfileStore } from '../state/tech-profile.js';
import type { GitHubPort } from './github-port.js';
import type { QrPagePort } from './qr-page-port.js';

/** The ports and settings behind every tool handler. */
export interface Runtime {
  mode: 'live' | 'simulated';
  /** True in live mode unless COMPASS_ALLOW_WRITES=1 (compass-power task 37): no Events API write. */
  readOnly?: boolean;
  version: string;
  events: EventsPort;
  rules: RulesPort;
  passes: PassesPort;
  snapshot: SnapshotStore;
  scanFs: ScanFs;
  specFs: SpecFs;
  clock: Clock;
  logger: Logger;
  cwd: string;
  /** Overrides the scanner's detectors. Left out in production, so the defaults apply. */
  scanDetectors?: readonly Detector[];
  /**
   * Runs the scan with a hard time budget (in a worker thread in production). When it is left out,
   * the scan runs in this thread, which tests and the source checkout use.
   */
  scanRunner?: (root: string) => Promise<ScanResult>;
  /** The Tech_Profile kept on this machine (task 42). */
  techProfile: TechProfileStore;
  /** GitHub, read-only (task 45). Left out in simulated mode, so no GitHub request is possible. */
  github?: GitHubPort;
  /**
   * The QR page in the browser (task 48). When it is left out, send_to_phone shows the QR code in
   * the chat instead.
   */
  qrPage?: QrPagePort;
}
