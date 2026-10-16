// Shared CLI helpers for the .github/scripts tools (foundation-contracts, S0).
//
// Each script keeps its real logic in exported, testable functions and a pure
// runCli() that returns { code, stdout, stderr }. These helpers apply a result to
// the process and detect whether the module is the entry point, so the entry
// wiring is covered in-process by tests (no subprocess, no coverage exclusion).

import { pathToFileURL } from 'node:url';

/**
 * Apply a pure CLI result to the current process: write output and set the exit
 * code. Returns nothing.
 *
 * @param {{ code: number, stdout?: string, stderr?: string }} result
 */
export function applyCli({ code, stdout = '', stderr = '' }) {
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
  process.exitCode = code;
}

/**
 * True when the given argv1 and module URL indicate this module is the process
 * entry point. Parameterised so tests can drive both outcomes.
 *
 * @param {string | undefined} argv1
 * @param {string} metaUrl
 * @returns {boolean}
 */
export function isMain(argv1, metaUrl) {
  return argv1 !== undefined && metaUrl === pathToFileURL(argv1).href;
}

/**
 * Run a CLI driver and apply it to the process, but only when this module is the
 * entry point. Exported and parameterised so a test can drive both the "is main"
 * and "not main" paths in-process.
 *
 * @param {object} options
 * @param {() => Promise<{ code: number, stdout?: string, stderr?: string }>} options.runCli
 * @param {string | undefined} options.argv1
 * @param {string} options.metaUrl
 * @returns {Promise<boolean>} whether the CLI ran
 */
export async function maybeRunCli({ runCli, argv1, metaUrl }) {
  if (!isMain(argv1, metaUrl)) {
    return false;
  }
  applyCli(await runCli());
  return true;
}
