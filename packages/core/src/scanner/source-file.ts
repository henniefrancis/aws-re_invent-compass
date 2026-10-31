// One file of a project as the Scanner sees it (compass-power task 41). The walker of a local
// folder and the GitHub archive reader both produce a stream of these, so the same detectors run
// over both. Internal to the scanner: a SourceFile is never returned by a scan.

/** One file. `text` is present only when the Scanner reads the file; otherwise it is counted by its name only. */
export interface SourceFile {
  relativePath: string;
  text?: string;
}
