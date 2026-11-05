import { quoted, summary, type ContentBlock } from './content-block';

// What leaves your machine, in plain words. Every line comes from build plan section 4.2
// (the personal data record) and the product principles. The lines about this website come
// from the showcase-site requirements, which describe how the site itself behaves.

const PLAN = 'docs/architecture/build-plan.md';
const PRODUCT = '.kiro/steering/product.md';
const SITE = '.kiro/specs/showcase-site/requirements.md';
const WALK = 'wiki/Decisions-Product-and-Scope.md';
const MCP_README = 'packages/mcp-server/README.md';

export interface PrivacySection {
  readonly id: 'stays' | 'leaves' | 'handoff' | 'site' | 'rights' | 'party';
  readonly heading: string;
  readonly items: readonly ContentBlock[];
}

export const PRIVACY_INTRO: ContentBlock = summary(
  'privacy-intro',
  'Compass keeps your data on your computer and sends as little as it can. This page lists what stays, what leaves and for how long.',
  PRODUCT,
  'Product principles, 4 and 5',
);

export const PRIVACY_SECTIONS: readonly PrivacySection[] = [
  {
    id: 'stays',
    heading: 'What stays on your machine',
    items: [
      summary(
        'privacy-tokens',
        'Your sign-in tokens (the access token, the refresh token and the ID token) stay in your computer keychain, or in memory only if your computer has no keychain. The access token goes only to the AWS Events API, the refresh token only to the sign-in service, and the ID token only to the Compass API.',
        MCP_README,
        'What leaves your machine',
      ),
      summary(
        'privacy-catalog-schedule',
        'The session catalog cache and a snapshot of your schedule stay in a folder on your computer. The snapshot is replaced each time Compass reads your schedule, and deleted when you run forget_me.',
        PLAN,
        '4.2 (P4)',
      ),
      summary(
        'privacy-issued-record',
        'The record of the passes you have issued stays in that same folder.',
        PLAN,
        '4.2 (P5)',
      ),
      summary(
        'privacy-week-spec',
        'Your week spec stays in your workspace. Compass offers to add it to .gitignore, because a public repo would publish where and when you will be.',
        PLAN,
        '4.2 (P6)',
      ),
      summary(
        'privacy-code-scan',
        'The code scan never stores file paths. Its result is your tech list, service and technology names with depth, kept in a folder on your computer. The week spec gets service names and depth only.',
        PLAN,
        '4.2 (P7)',
      ),
      summary(
        'privacy-tech-list',
        'Your tech list, the AWS services and other technology from the folders and GitHub repositories you scan, stays in a folder on your computer. Each project is stored under a one-way hash, so no path or repository name is kept. forget_me deletes it.',
        MCP_README,
        'What leaves your machine',
      ),
      summary(
        'privacy-generated-files',
        'Compass writes no pass files on your computer: your phone gets its passes from the Compass API through the hand-off. The files it writes are the calendar file, in its folder on your computer, and a temporary QR code page in your temp folder. The QR code page is deleted when its link expires, when a newer one replaces it, when you run forget_me and when the server stops.',
        MCP_README,
        'Passes on your phone',
      ),
    ],
  },
  {
    id: 'leaves',
    heading: 'What leaves your machine, and for how long',
    items: [
      summary(
        'privacy-id-token',
        'Your ID token goes only to the Compass API, as proof that you are signed in. It is never stored there. The server keeps only a one-way keyed hash of your sign-in identifier.',
        PLAN,
        '4.2 (P3, P10)',
      ),
      summary(
        'privacy-pass-fields',
        'The printable pass fields go to the Compass API: the session code and title, the venue and room, the times, the walk from the previous session and the next connection. They are kept until the session ends plus 24 hours.',
        PLAN,
        '4.2 (P10) and 2 (A1)',
      ),
      summary(
        'privacy-name',
        'Your name is sent only if you choose to add it. It is typed on your machine and never taken from your sign-in token.',
        PLAN,
        '4.2 (P8)',
      ),
      summary(
        'privacy-apple-push',
        'For Apple Wallet, your device push token is kept until your device unregisters the pass or the pass record expires.',
        PLAN,
        '4.2 (P11)',
      ),
      summary(
        'privacy-google-objects',
        'For Google Wallet, Google holds the pass object. A voided pass is set to inactive, and every pass expires at its session end.',
        PLAN,
        '4.2 (P15)',
      ),
      summary(
        'privacy-processing-region',
        'The Compass server runs in the AWS us-east-1 Region (N. Virginia, United States), outside South Africa, in the AWS account of the owner.',
        PLAN,
        '1, 4.2 and 7',
      ),
      summary(
        'privacy-processors',
        'Apple processes data (the push token) when you add a pass to Apple Wallet. Google holds the pass object from the moment the pass is issued, so that the Add to Google Wallet link works. Google acts as a processor.',
        PLAN,
        '4.2 (P15, P16)',
      ),
      summary(
        'privacy-github',
        'If you connect GitHub, Compass uses a GitHub App that can only read code. Your GitHub tokens stay in your computer keychain and go only to github.com and api.github.com. Repository archives are read in memory on your computer and never saved, and nothing about your repositories goes to Compass or AWS.',
        MCP_README,
        'What leaves your machine',
      ),
      summary(
        'privacy-logs',
        'The Compass API keeps its logs for 14 days. Its access log records the request path pattern, not your IP address.',
        PLAN,
        '7.2 (infra/modules/api)',
      ),
      summary(
        'privacy-no-backup',
        'Point-in-time recovery is off on the Compass API table, so there is no backup copy of data that expires or that forget_me deletes.',
        PLAN,
        '7.2 (infra/modules/data)',
      ),
      quoted('privacy-no-human', 'No human reads server data in normal operation.', PLAN, '4.2'),
    ],
  },
  {
    id: 'handoff',
    heading: 'Hand-offs, forget_me and passes that cannot be deleted',
    items: [
      summary(
        'privacy-handoff-expiry',
        'A hand-off lasts 15 minutes. After that, the link stops working.',
        PLAN,
        '4.2 (P12)',
      ),
      summary(
        'privacy-handoff-fragment',
        'The hand-off link keeps its secret in the part of the web address after the # sign, which a browser never sends to the website.',
        PLAN,
        '4.1 (handoffId)',
      ),
      summary(
        'privacy-forget-me',
        'forget_me voids every pass for you and deletes your pass records, device registrations and hand-offs on the server. On your computer it also deletes your schedule snapshot, your issued-pass record, the calendar file and itinerary page, your tech list, your GitHub sign-in and any QR code page. Passes already in a wallet on your phone stay there, voided, until they expire or you remove them.',
        MCP_README,
        'What leaves your machine',
      ),
      summary(
        'privacy-rate-counters',
        'forget_me does not delete the server rate counters, which are tied to a one-way hash of your sign-in identifier, so that it cannot reset the limits. They are deleted when their one-hour window ends plus 2 minutes.',
        PLAN,
        '4.2 (P13, DELETE /api/v1/me)',
      ),
      quoted(
        'privacy-no-remote-delete',
        'No wallet allows a pass to be deleted remotely',
        PRODUCT,
        'Core features, 6',
      ),
      summary(
        'privacy-void-expire',
        'Compass voids the pass of a cancelled session, and every pass expires at its session end.',
        PRODUCT,
        'Core features, 6',
      ),
    ],
  },
  {
    id: 'site',
    heading: 'What this website does',
    items: [
      summary(
        'privacy-site-none',
        'This website has no sign-in, no cookies, no browser storage, no analytics and no requests to other websites.',
        SITE,
        'Requirement 2',
      ),
      summary(
        'privacy-site-demo',
        'The demo runs in your browser. It uses a small snapshot of real sessions from the AWS Events API, copied into the website. It never connects to the API, and nothing in it touches a real schedule.',
        SITE,
        'Requirements 2 and 7',
      ),
      summary(
        'privacy-site-session-data',
        'The session catalog is public. The demo snapshot holds only the session code, title, start and end times, venue and room, so it has no speakers, no attendees and no personal data.',
        'docs/hackathon-rules.md',
        'Compliance, rule 11',
      ),
      summary(
        'privacy-site-board',
        'The board page keeps your hand-off link in the memory of the page only. It removes the link from the address bar as soon as it has read it, and it never stores, logs or shares it.',
        SITE,
        'Requirement 16',
      ),
      summary(
        'privacy-site-walk',
        'On the board page, Walk from here asks your phone for its location only when you tap it. The walking time is worked out on your phone. Compass does not send your location anywhere, save it or log it. Your phone may use its own location service to find it. The Directions link opens Apple Maps or Google Maps, and that app gets your location only when you open the link.',
        WALK,
        'Walk from here on the board page',
      ),
    ],
  },
  {
    id: 'party',
    heading: 'Who is responsible',
    items: [
      summary(
        'privacy-party',
        'The responsible party is Hennie Francis, acting personally.',
        PLAN,
        '4.2',
      ),
    ],
  },
  {
    id: 'rights',
    heading: 'Your rights and how to ask',
    items: [
      summary(
        'privacy-rights',
        'forget_me is how you use your POPIA rights for the data Compass keeps on the server.',
        PLAN,
        '4.2 (DELETE /api/v1/me)',
      ),
      summary(
        'privacy-contact',
        'To ask about your data, use private vulnerability reporting on the project repository on GitHub.',
        PLAN,
        '4.2',
      ),
      summary(
        'privacy-regulator',
        'You may also complain to the Information Regulator (South Africa).',
        PLAN,
        '4.2',
      ),
    ],
  },
];

/** Every block on the Privacy_Page, in reading order. */
export function privacyBlocks(): readonly ContentBlock[] {
  return [PRIVACY_INTRO, ...PRIVACY_SECTIONS.flatMap((section) => section.items)];
}
