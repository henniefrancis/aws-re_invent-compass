# ADR-005 Device strategy

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

Planning needs the attendee's code and an MCP client, which only a computer has. During the week the attendee lives on a phone. The owner answered "plan on a computer, board on any device" in the architect interview (ADR-004 item 1).

## Decision

- **Plan on a computer:** the Kiro Power and the local Compass MCP server run on the attendee's computer, in Kiro, Claude Desktop, VS Code or the Kiro CLI.
- **Board on any device:** phones and tablets get Apple or Google Wallet passes through a QR hand-off (ADR-011), an `.ics` calendar file, and an offline itinerary page (single HTML file, inline CSS, no JS or network, WCAG 2.2 AA on a phone).
- The showcase site and its click-through demo on made-up sessions work on any device with no install.
- Site tests run on 7 profiles: Desktop Chrome, Firefox, WebKit; iPad portrait and landscape; iPhone portrait and landscape.
- Real-device checks at the release gate: iPhone, Apple Watch if available, Android, Mac, Windows 11, Linux or WSL.

## Consequences

- No hosted web app that signs attendees in.
- The Power must work on Windows, macOS and Linux. On Linux with no Secret Service, tokens are kept in memory only and the attendee signs in each session.
- The local product still works with no Compass API at all (`.ics` and the itinerary page).
- The itinerary page is cut-list item 1; passes and `.ics` remain if it is cut.

## Source

- re:Invent Compass build plan sections 1, 3.1, 3.3, 6, 8 (S4, S7), 11.2, 12.
- ADR-004 item 1.
