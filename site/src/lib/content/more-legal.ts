// The Terms_Page, Accessibility_Page, Security_Page and Credits_Page (showcase-site task 32,
// Requirement 28). Plain English, not legal advice; each says only what the project already does.

import { summary, type ContentBlock } from './content-block';

export const TERMS_TITLE = 'Terms of use';
export const TERMS_UPDATED = 'Last updated 22 October 2026.';

export const TERMS_BLOCKS: readonly ContentBlock[] = [
  summary(
    'terms-scope',
    'These terms cover the re:Invent Compass website, the Compass MCP server and the Kiro Power. By using them, you agree to these terms.',
    '.kiro/specs/showcase-site/requirements.md',
    '28.2',
  ),
  summary(
    'terms-as-is',
    'Compass is free and open source. It is provided "as is" under the Apache License 2.0, without warranties, and you use it at your own risk.',
    'LICENSE',
    '7. Disclaimer of Warranty',
  ),
  summary(
    'terms-no-seat',
    'Compass does not guarantee a seat. AWS re:Invent decides seats, sessions and times, and the official re:Invent app is the source of truth for your schedule.',
    '.kiro/specs/showcase-site/requirements.md',
    '28.2',
  ),
  summary(
    'terms-pass',
    'Compass passes are unofficial and are not tickets. Your re:Invent badge is your ticket.',
    '.kiro/steering/product.md',
    'Product principles, 1',
  ),
  summary(
    'terms-handoff',
    'A hand-off link and its QR code work for 15 minutes and give access to your passes. Do not share them.',
    '.kiro/specs/showcase-site/requirements.md',
    '28.2',
  ),
  summary(
    'terms-misuse',
    "Do not misuse the Compass pass service: no automated mass requests, no attempts to read other people's passes and no attempts to break its security. Report security problems privately instead.",
    '.kiro/specs/showcase-site/requirements.md',
    '28.2',
  ),
  summary(
    'terms-you',
    'You are responsible for your AWS Builder ID and for every change you approve. By default, Compass does not change your re:Invent schedule.',
    'packages/mcp-server/README.md',
    'Read-only by default',
  ),
  summary(
    'terms-changes',
    'These terms may change. The date above shows when they last did, and questions go to the repository.',
    '.kiro/specs/showcase-site/requirements.md',
    '28.2',
  ),
];

export const ACCESSIBILITY_TITLE = 'Accessibility';

export const ACCESSIBILITY_BLOCKS: readonly ContentBlock[] = [
  summary(
    'a11y-aim',
    're:Invent Compass aims to meet WCAG 2.2 level AA on every page of this site.',
    '.kiro/specs/showcase-site/requirements.md',
    '19.1',
  ),
  summary(
    'a11y-keyboard',
    'Every page works with a keyboard alone and with a screen reader. Focus is always visible, and each page has one main heading that takes the focus when you arrive.',
    '.kiro/specs/showcase-site/requirements.md',
    '19.6',
  ),
  summary(
    'a11y-visual',
    'Text and controls meet the AA contrast ratios, the layout works from small phones to wide screens, high contrast mode keeps every control visible, and nothing moves if you ask for reduced motion.',
    '.kiro/specs/showcase-site/requirements.md',
    '19.4 and 19.10',
  ),
  summary(
    'a11y-testing',
    'Every page is tested with axe on seven browser and device profiles: Chrome, Firefox and Safari on desktop, and iPad and iPhone in both orientations.',
    '.kiro/specs/showcase-site/requirements.md',
    '22.3',
  ),
  summary(
    'a11y-wallet',
    'The passes themselves are drawn by Apple Wallet and Google Wallet, which bring their own accessibility features.',
    '.kiro/specs/showcase-site/requirements.md',
    '28.3',
  ),
];

export const SECURITY_TITLE = 'Security';

export const SECURITY_BLOCKS: readonly ContentBlock[] = [
  summary(
    'security-report',
    "Please report a security problem privately through GitHub's private vulnerability reporting, never as a public issue. Include what you found, how to reproduce it and the impact you expect.",
    'SECURITY.md',
    'Reporting a vulnerability',
  ),
  summary(
    'security-response',
    'You will get an acknowledgement within a few days. Please give a reasonable time for a fix before you share details publicly.',
    'SECURITY.md',
    'Reporting a vulnerability',
  ),
  summary(
    'security-secrets',
    'No secret, token, key, certificate or account identifier is ever committed. Server secrets live in AWS Secrets Manager, and your sign-in tokens stay in your own operating system keychain.',
    'SECURITY.md',
    'How the project handles secrets',
  ),
  summary(
    'security-read-only',
    'Compass is read-only on your re:Invent schedule by default, and session text reaches your assistant as labelled data, never as instructions.',
    'packages/mcp-server/README.md',
    'Read-only by default',
  ),
  summary(
    'security-scope',
    "In scope: this project's code, the Compass API it deploys, the Kiro Power and the npm package. Problems in the AWS Events API, AWS Builder ID, Apple Wallet or Google Wallet go to their owners.",
    'SECURITY.md',
    'Scope',
  ),
];

export const CREDITS_TITLE = 'Open-source credits';
export const CREDITS_INTRO =
  'Compass stands on the work of many open-source projects. These are the main ones, with their licences.';

/** One credited library. `pkg` is the npm package whose licence a test checks. */
export interface Credit {
  readonly name: string;
  readonly pkg: string;
  readonly use: string;
  readonly licence: string;
}

export const CREDITS: readonly Credit[] = [
  { name: 'Angular', pkg: '@angular/core', use: 'This website', licence: 'MIT' },
  { name: 'RxJS', pkg: 'rxjs', use: 'This website', licence: 'Apache-2.0' },
  {
    name: 'MCP TypeScript SDK',
    pkg: '@modelcontextprotocol/sdk',
    use: 'The Compass MCP server',
    licence: 'MIT',
  },
  { name: 'Zod', pkg: 'zod', use: 'Checking every request and reply', licence: 'MIT' },
  {
    name: 'passkit-generator',
    pkg: 'passkit-generator',
    use: 'Apple Wallet passes',
    licence: 'MIT',
  },
  {
    name: 'Google Auth Library',
    pkg: 'google-auth-library',
    use: 'Google Wallet passes',
    licence: 'Apache-2.0',
  },
  {
    name: 'AWS SDK for JavaScript v3',
    pkg: '@aws-sdk/client-dynamodb',
    use: 'The pass service on AWS',
    licence: 'Apache-2.0',
  },
  {
    name: 'aws-jwt-verify',
    pkg: 'aws-jwt-verify',
    use: 'Checking sign-ins',
    licence: 'Apache-2.0',
  },
  { name: 'node-qrcode', pkg: 'qrcode', use: 'The hand-off QR code', licence: 'MIT' },
  { name: 'ical-generator', pkg: 'ical-generator', use: 'Calendar files', licence: 'MIT' },
  {
    name: '@napi-rs/keyring',
    pkg: '@napi-rs/keyring',
    use: 'Keeping your sign-in in the keychain',
    licence: 'MIT',
  },
  { name: 'Vitest', pkg: 'vitest', use: 'Unit tests', licence: 'MIT' },
  { name: 'fast-check', pkg: 'fast-check', use: 'Property tests', licence: 'MIT' },
  { name: 'Playwright', pkg: '@playwright/test', use: 'Browser tests', licence: 'Apache-2.0' },
  {
    name: 'axe-core for Playwright',
    pkg: '@axe-core/playwright',
    use: 'Accessibility tests',
    licence: 'MPL-2.0',
  },
  {
    name: 'TypeScript',
    pkg: 'typescript',
    use: 'The language Compass is written in',
    licence: 'Apache-2.0',
  },
];
