// The fixed error table (Requirement 17.1, design Error Handling). The mapper has no
// parameter for tool input, so nothing the model supplied can be echoed. Upstream error
// text is never used; the only variable parts are a wait in seconds and a pass-side summary
// that S4 already redacted (it passes through local redaction again).

import { FolderNotFoundError, ScanTimeoutError } from '@compass/core/scanner';
import { SpecWriteRefusedError } from '@compass/core/spec';
import { ZodError } from 'zod';
import { redact as redactText } from '@compass/core/redact';
import { CompassError } from '../ports/errors.js';
import type { CompassErrorCode } from '../ports/errors.js';

/** The message for an unexpected failure. */
export const INTERNAL_MESSAGE =
  'Compass hit an internal problem. Nothing was changed by this step.';

/** The message when the read-only default stops a write (compass-power task 37). */
export const READ_ONLY_MESSAGE =
  'Compass is read-only, so nothing in your re:Invent schedule changed. Make this change yourself in the re:Invent app.';

const FIXED: Record<Exclude<CompassErrorCode, 'RateLimited' | 'PassError'>, string> = {
  FolderNotFound: 'That folder could not be found.',
  IdentifierRejected: 'One of the ids is not a valid session id.',
  UnknownSession:
    'That session is not in the catalog Compass has cached. Run refresh_catalog, then try again.',
  CatalogMissing: 'Run refresh_catalog first.',
  NotSignedIn: 'Run sign_in first.',
  Unauthorized: 'Your sign-in expired. Run sign_in.',
  Forbidden: 'Your account is not allowed to do that.',
  NotFound: 'The Events service could not find that.',
  Conflict: 'The Events service reports a conflict with your schedule.',
  BadRequest: 'The Events service did not accept that request.',
  Validation: 'The Events service sent data Compass could not read.',
  Server: 'The Events service had a problem. Compass did not retry.',
  UnexpectedResponse: 'The Events service sent an unexpected answer.',
  EventWindow: 'The event dates could not be read, so Compass will not guess them.',
  SpecWriteRefused: 'Compass could not write that file safely, so it wrote nothing.',
  MaxPerDayRange: 'maxPerDay must be a whole number from 1 to 8.',
  LayoverInvalid:
    'The layover times are not valid. Give a start and an end with time zone offsets, on 5 minute steps, inside the event dates, with the end after the start and on the same day in Las Vegas time (a layover cannot cross midnight).',
  LimitInvalid: 'limit must be a whole number from 0 to 50.',
  NoPassesIssued: 'No Boarding Passes have been issued yet. Run issue_all_boarding_passes first.',
  BulkVoidRefused:
    'This sync would void every pass or more than five passes. Compass needs your explicit confirmation for that, and this client cannot ask. Name fewer sessions in sessionIds, or use a client that supports confirmation.',
  Network: 'Compass could not reach the service. Check your connection, then try again.',
  ScanTimeout: 'The scan took too long and was stopped. Try a smaller folder.',
  InputTooLarge: 'The search text is limited to 200 characters, and plan goals to 20 items.',
  LevelInvalid: 'level must be 100, 200, 300 or 400.',
  InputInvalid: 'Compass could not read that request. Check the arguments and try again.',
  ScanOutsideWorkspace:
    'That folder is outside the workspace Compass was started in, and this client cannot ask you to confirm it. Start Compass in that folder, or use a client that can ask.',
  UnsafePath: 'Compass will not write through a symbolic link, so it wrote nothing.',
  ReadOnly: READ_ONLY_MESSAGE,
  GitHubNotConnected:
    'Compass is not connected to GitHub, or the connection has ended. Run connect_github, then try again.',
  GitHubConfirmationNeeded:
    'Compass reads your GitHub repositories only after you confirm the list, and this client cannot ask. Use a client that can ask you to confirm.',
  ConfirmTimedOut:
    'Nothing was changed, because the confirmation was not answered within 5 minutes. Ask again when you are ready.',
  Internal: INTERNAL_MESSAGE,
};

/** How many problems one input message names. */
const MAX_INPUT_PROBLEMS = 3;

type Issue = ZodError['issues'][number];

/** `commitments[0].sessionId`. Every segment is a schema key or an index: tool inputs have no records. */
function pathText(path: readonly PropertyKey[]): string {
  const text = path
    .map((segment) => (typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`))
    .join('')
    .replace(/^\./, '');
  return text === '' ? 'the request' : text;
}

/**
 * What is wrong with one issue, from the schema side only: the expected type, the allowed values
 * or a limit. The value that was sent is never part of it.
 */
function problemFor(issue: Issue): string {
  switch (issue.code) {
    case 'invalid_type':
      return / received undefined$/.test(issue.message)
        ? 'is missing'
        : `should be ${issue.expected === 'array' || issue.expected === 'object' ? 'an' : 'a'} ${issue.expected}`;
    case 'invalid_value':
      return `should be one of: ${issue.values.map(String).join(', ')}`;
    case 'too_small':
      return issue.origin === 'array'
        ? `needs at least ${issue.minimum} ${Number(issue.minimum) === 1 ? 'item' : 'items'}`
        : 'is too small';
    case 'too_big':
      return issue.origin === 'array' ? `takes at most ${issue.maximum} items` : 'is too large';
    default:
      return 'is not valid';
  }
}

/** One field and what is wrong with it. */
interface Problem {
  where: string;
  text: string;
}

/** The problems of one issue; a union reports the alternative that came closest. */
function problemsOf(issue: Issue): Problem[] {
  if (issue.code === 'invalid_union' && issue.errors.length > 0) {
    const closest = [...issue.errors].sort((a, b) => a.length - b.length)[0] as Issue[];
    return closest.flatMap((inner) =>
      problemsOf({ ...inner, path: [...issue.path, ...inner.path] }),
    );
  }
  const where = pathText(issue.path);
  // A refinement's message is written in the contracts, never built from the input.
  return [
    { where, text: issue.code === 'custom' ? issue.message : `${where} ${problemFor(issue)}` },
  ];
}

/**
 * The message for a request that does not match the tool's input schema (compass-power task 69):
 * it names the fields that are wrong and what each expects, so the caller can correct the
 * request, and never repeats anything that was sent. Each field is named once, with its first
 * problem.
 */
function inputProblem(error: ZodError): string {
  const byField = new Map<string, string>();
  for (const problem of error.issues.flatMap(problemsOf)) {
    if (!byField.has(problem.where)) {
      byField.set(problem.where, problem.text);
    }
  }
  const problems = [...byField.values()].slice(0, MAX_INPUT_PROBLEMS);
  return problems.length === 0
    ? FIXED.InputInvalid
    : `Compass could not read that request: ${problems.join('; ')}. Check the arguments and try again.`;
}

/** The plain-English message for a failure. */
export function messageFor(error: unknown): string {
  if (error instanceof FolderNotFoundError) {
    return FIXED.FolderNotFound;
  }
  if (error instanceof ZodError) {
    return inputProblem(error);
  }
  if (error instanceof ScanTimeoutError) {
    return FIXED.ScanTimeout;
  }
  if (error instanceof SpecWriteRefusedError) {
    return FIXED.SpecWriteRefused;
  }
  if (!(error instanceof CompassError)) {
    return INTERNAL_MESSAGE;
  }
  if (error.code === 'RateLimited') {
    const seconds = error.details.retryAfterSeconds;
    return seconds === undefined
      ? 'Too many requests. Wait a little while, then try again. Compass did not retry.'
      : `Too many requests. Wait ${Math.max(1, Math.ceil(seconds))} seconds, then try again. Compass did not retry.`;
  }
  if (error.code === 'PassError') {
    const summary = error.details.summary;
    return summary === undefined
      ? 'The pass service could not do that.'
      : `The pass service could not do that: ${redactText(summary)}`;
  }
  return FIXED[error.code];
}

/** The code used in log lines for a failure (never any message text). */
export function codeFor(error: unknown): string {
  if (error instanceof CompassError) {
    return error.code;
  }
  return error instanceof ZodError ? 'InputInvalid' : 'unexpected';
}
