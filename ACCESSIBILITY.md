# Accessibility statement

re:Invent Compass aims to meet [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA on every page of the showcase site, https://reinvent-compass.vegas, including the demo and the board page. The same statement is on the site at https://reinvent-compass.vegas/accessibility.

## What we do

- **Keyboard and screen readers.** Every page works with a keyboard alone and with a screen reader. Focus is always visible, and each page has one main heading that takes the focus when you arrive.
- **Seeing the page.** Text and controls meet the AA contrast ratios, the layout works from small phones to wide screens, high contrast mode keeps every control visible, and nothing moves if you ask for reduced motion.
- **Links.** Links that open a new tab say so to screen readers.
- **Wallet passes.** The passes themselves are drawn by Apple Wallet and Google Wallet, which bring their own accessibility features.
- **The MCP server and the Kiro Power** work through your assistant's chat, so they follow your client's accessibility support. Their answers are plain text with the session codes, titles and times written out.

## How we test it

- Every page is tested with [axe](https://github.com/dequelabs/axe-core) on seven browser and device profiles: Chrome, Firefox and Safari on desktop, and iPad and iPhone in both orientations, on every change.
- Lighthouse scores 100 for accessibility on all 14 pages (measured 5 November 2026).
- Keyboard focus and forced colours (high contrast) have their own browser tests.

## Known limits

- A pass on the lock screen shows only what Apple Wallet or Google Wallet choose to show.

## Report a barrier

If something on the site, the board page or a pass is hard or impossible to use with your setup, [open an accessibility issue](https://github.com/henniefrancis/aws-re_invent-compass/issues/new?template=accessibility_barrier.yml). Tell us the page, your setup and what got in your way, and we will fix it.

Last reviewed: 6 November 2026.
