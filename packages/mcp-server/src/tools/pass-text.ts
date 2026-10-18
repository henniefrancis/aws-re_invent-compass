// Fixed pass wording shared by the pass tools (Requirement 15.3): each pass is unofficial, the
// badge is the ticket, and a pass cannot be deleted from a phone remotely.

/** The disclaimer shown with issued passes and hand-offs. */
export const PASS_DISCLAIMER =
  'Each pass is unofficial. Your badge is your ticket, and the pass does not replace it.';

/** What happens to a voided pass. */
export const VOID_NOTE =
  "A voided pass moves to your wallet's expired passes. Compass cannot delete it from your phone.";

/** Said with every hand-off link and QR code (security L1). */
export const HANDOFF_SHARING_NOTE =
  'Do not share this link or the QR code. Anyone who has it can see these passes until it expires.';

/** The link without its fragment: the part that is safe to keep in structured results and logs. */
export function withoutFragment(url: string): string {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}
