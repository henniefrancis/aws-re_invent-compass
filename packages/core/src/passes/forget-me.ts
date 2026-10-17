// The forgetMe orchestrator for the pass side (boarding-passes, S4, Requirement 2.7).
//
// The Compass_Client only calls the API; this orchestrator composes the client, the
// Pass_Store and the filesystem. It calls DELETE /api/v1/me and, only when the answer is a
// 202, removes the local Issued_Pass_Record and the generated output files. On any other
// status it leaves every local file untouched. A client error (a problem body, a
// validation failure, a transport failure) propagates unchanged and likewise touches
// nothing.
//
// The copy it returns is honest about wallets: passes are voided and will expire, and the
// copy never claims a pass was deleted from the phone, because no wallet permits remote
// deletion.
import {
  CALENDAR_FILE_NAME,
  ITINERARY_FILE_NAME,
  joinInFolder,
  OUTPUT_FOLDER_NAME,
} from './app-data.js';
import type { CompassClient } from './compass-client.js';
import type { AppDataResolver, FileSystem } from './interfaces.js';
import type { PassStore } from './pass-store.js';
import { passError } from './redaction.js';

/** The status that confirms the server accepted the deletion. */
const ACCEPTED = 202;

/** What forgetMe composes. */
export interface ForgetMeDeps {
  client: CompassClient;
  store: PassStore;
  fs: FileSystem;
  appData: AppDataResolver;
}

/** The outcome of forgetMe. */
export interface ForgetMeOutcome {
  /** The HTTP status the server answered. */
  status: number;
  /** True when the local record and output files were removed (only after a 202). */
  localDataRemoved: boolean;
  /** Attendee-facing copy. States that passes are voided and will expire. */
  copy: string;
}

/** The copy after a confirmed deletion. */
function acceptedCopy(voided: number, deleted: number): string {
  return [
    `Done. ${String(voided)} pass(es) were voided and will expire, and ${String(deleted)} server record(s) were removed.`,
    'Your local pass record, calendar file and itinerary page were removed from this computer.',
    'Passes already in a wallet stay on the phone until you remove them yourself, but they are voided and will expire.',
  ].join(' ');
}

/** The copy when the server did not confirm the deletion. */
function notConfirmedCopy(status: number): string {
  return `The server answered ${String(status)} instead of confirming the deletion, so your local files were kept. Passes already issued are not changed.`;
}

/**
 * Forget the attendee: ask the server to void and delete, then remove the local files only
 * if the server accepted. Throws a PassError when the server accepted but a local file could
 * not be removed, so the attendee knows the local copy still exists.
 */
export async function forgetMe(deps: ForgetMeDeps): Promise<ForgetMeOutcome> {
  const { client, store, fs, appData } = deps;
  const { status, response } = await client.forgetMe();
  if (status !== ACCEPTED) {
    return { status, localDataRemoved: false, copy: notConfirmedCopy(status) };
  }

  const root = appData.resolve();
  const outputs = [CALENDAR_FILE_NAME, ITINERARY_FILE_NAME].map((name) =>
    joinInFolder(root, OUTPUT_FOLDER_NAME, name),
  );
  let failed = false;
  try {
    await store.deleteRecord();
  } catch {
    failed = true;
  }
  for (const output of outputs) {
    try {
      await fs.remove(output);
    } catch {
      failed = true;
    }
  }
  if (failed) {
    throw passError(
      'forget.local_removal_failed',
      'The server accepted the deletion, but some local files could not be removed. Remove the reinvent-compass app-data folder by hand.',
    );
  }
  return {
    status,
    localDataRemoved: true,
    copy: acceptedCopy(response.voided, response.deleted),
  };
}
