// The forgetMe orchestrator for the pass side (boarding-passes, S4, Requirement 2.7).
//
// The Compass_Client only calls the API; this orchestrator composes the client, the
// Pass_Store and the filesystem. It calls DELETE /api/v1/me and cleans up locally when the
// server accepted the deletion (202, even if the body does not match the contract) or holds
// nothing for the attendee (404 or 410, so a retry after a half-finished forget still
// finishes the job). Cleanup removes the Issued_Pass_Record and the whole output folder. On
// any other status it leaves every local file untouched. A client error (a problem body, a
// transport failure) propagates unchanged and likewise touches nothing.
//
// The copy it returns is honest about wallets: passes are voided and will expire, and the
// copy never claims a pass was deleted from the phone, because no wallet permits remote
// deletion.
import { joinInFolder, OUTPUT_FOLDER_NAME } from './app-data.js';
import type { CompassClient } from './compass-client.js';
import type { AppDataResolver, FileSystem } from './interfaces.js';
import type { PassStore } from './pass-store.js';
import { passError } from './redaction.js';

/** The statuses after which local cleanup is safe. */
const CLEANUP_STATUSES = new Set([202, 404, 410]);

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
  /** True when the local record and output folder were removed. */
  localDataRemoved: boolean;
  /** Attendee-facing copy. States that passes are voided and will expire. */
  copy: string;
}

const WALLET_NOTE =
  'Passes already in a wallet stay on the phone until you remove them yourself, but they are voided and will expire.';
const LOCAL_NOTE =
  'Your local pass record, calendar file and itinerary page were removed from this computer.';

/** The copy after a confirmed deletion, with the counts when the server gave them. */
function acceptedCopy(counts: { voided: number; deleted: number } | undefined): string {
  const lead =
    counts === undefined
      ? 'Done. Your passes were voided and will expire, and your server records were removed.'
      : `Done. ${String(counts.voided)} pass(es) were voided and will expire, and ${String(counts.deleted)} server record(s) were removed.`;
  return [lead, LOCAL_NOTE, WALLET_NOTE].join(' ');
}

/** The copy when the server holds nothing for the attendee. */
function nothingHeldCopy(): string {
  return [
    'The server holds nothing for you, so there is nothing more to void. Any passes were already voided and will expire.',
    LOCAL_NOTE,
    WALLET_NOTE,
  ].join(' ');
}

/** The copy when the server did not confirm the deletion. */
function notConfirmedCopy(status: number): string {
  return `The server answered ${String(status)} instead of confirming the deletion, so your local files were kept. Passes already issued are not changed.`;
}

/**
 * Forget the attendee: ask the server to void and delete, then remove the local files if the
 * server accepted or holds nothing. Throws a PassError when cleanup is due but a local file
 * could not be removed, so the attendee knows a local copy still exists.
 */
export async function forgetMe(deps: ForgetMeDeps): Promise<ForgetMeOutcome> {
  const { client, store, fs, appData } = deps;
  const { status, response } = await client.forgetMe();
  if (!CLEANUP_STATUSES.has(status)) {
    return { status, localDataRemoved: false, copy: notConfirmedCopy(status) };
  }

  let failed = false;
  try {
    await store.deleteRecord();
  } catch {
    failed = true;
  }
  try {
    await fs.remove(joinInFolder(appData.resolve(), OUTPUT_FOLDER_NAME));
  } catch {
    failed = true;
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
    copy: status === 202 ? acceptedCopy(response) : nothingHeldCopy(),
  };
}
