# ADR-037 Walk from here: a walking time to the next session, worked out on the phone

Status: Accepted, 2026-10-30 (owner decisions). Implemented in showcase-site task 40 and pass-service task 53 (tracker L01).

## Context

At re:Invent the venues are far apart. The venue file (`data/venues.json`) already holds walking times between the six official venues, from OpenStreetMap foot routing. An attendee standing in a hotel lobby wants a different answer: how long from where I am to my next session, and when must I leave. The board page already holds the attendee's sessions (their Boarding Passes) and opens on their phone, so it is the natural place.

Location is personal data. The first rule is that it stays on the phone.

## Decision

- **Next session only.** The board page marks one session: the first that has not started, by the event's own time (each start carries its offset, so the phone's own time zone does not matter). If every session has started, nothing is marked. Only that session gets the button.
- **The attendee taps first.** The page shows the button "Walk from here". The browser is asked for the location only when the attendee taps it, once (`getCurrentPosition`, never `watchPosition`). Nothing is requested when the page loads. If the session has no venue, or the venue has no map point, the page says so and does not ask for the location at all.
- **An estimate on the phone plus a Directions link.** The page shows "About N min walk." and "Leave by 9:48 AM." (12-hour like the session times, in event time), says "This is an estimate.", and offers a Directions link: Apple Maps on an iPhone, Google Maps on everything else (the same device check as the wallet buttons). The link names only the venue's point, so the maps app starts from the phone's own location.
- **No estimate in five cases.** Location denied, location unavailable, location timed out, no venue on the pass, no map point for the venue, and a phone more than 20 km from the venue. Each shows one short plain message.
- **If it is too late to leave.** When the leave-by time has already passed at the tap, the page says "Leave now." instead of a time in the past.
- **The result is a snapshot.** It shows "Worked out at 7:31 AM." (the tap time, 12-hour, written in the session's event offset) so the attendee can see how old it is. It does not change as time passes. The result belongs to the session it was made for: it shows only under that session, and a location answer that arrives after another session has become next is dropped.
- **A prompt that is never answered.** Some browsers never answer when the attendee dismisses the permission prompt (for example Firefox "Not now"). After 20 seconds the page treats it as "unavailable" and the attendee can tap again. While the phone is finding its location the button shows as busy (`aria-busy`, `aria-disabled`) but stays focusable.
- **Directions link.** Its accessible name says it opens in a new tab, as the site header links do.
- **One Permissions-Policy value.** `site/scripts/required-permissions-policy.mjs` holds it. The preview and e2e server sends it, and an infra static test pins that the CloudFront value equals it, that `geolocation=(self)` is in it and that no entry is `*`.

### The venue points

- **The Venetian uses the Venetian Expo point** (OSRM point 7, `36.1219124, -115.1662288`), not the hotel point (point 5, `36.1217073, -115.1693352`). The two are about 280 m apart. Sessions at The Venetian are held in the Venetian Expo (the venue file lists "The Venetian Expo" and "Venetian Expo" as spellings of this venue), and the existing walking times to and from The Venetian were computed from point 7, so the phone and the venue file agree.
- **The Caesars Forum point lies on its Koval Lane loading-dock side.** Directions to this point may end there, not at a front door. The point comes from the same OSRM table, so the walking times in the venue file share this. It is a point on the resort, not a door.
- QA reverse-geocoded all seven points on OpenStreetMap Nominatim and each matches the building named for it.

### The numbers

| Number                              | Value                                | Where it comes from                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Venue points                        | latitude and longitude of each venue | The point of each venue in the OpenStreetMap foot routing table (OSRM) that the venue file's walking times already use. The coordinates were inside the URLs in the walking times' `basis` text. They are now explicit fields with a source note in `data/venues.json`. A point on the resort, not a door. Not an official AWS location. |
| Pace                                | 66.7 metres a minute                 | The pace the venue walking times use, stated in `data/venues.json`.                                                                                                                                                                                                                                                                      |
| Detour factor                       | 1.6                                  | Compass's own assumption. Walking distances between the 15 pairs of venues in `data/venues.json` are 1.33 to 2.99 times the straight line, with a median of 1.66 (a test recomputes this from the file). Rounded to 1.6. It is not taken from a published source.                                                                        |
| Time into the venue and to the room | 15 minutes                           | The same 15 minutes the venue walking times add for leaving one building and entering the next. The phone is often inside a hotel when the attendee taps, so both parts apply. Compass's own assumption.                                                                                                                                 |
| Distance limit                      | 20 km                                | The owner's decision. Farther than this the estimate says nothing useful.                                                                                                                                                                                                                                                                |

Walking minutes = round up of (straight-line distance in metres x 1.6 / 66.7), at least 1. Straight-line distance is the haversine distance on a sphere of radius 6,371,008.8 m. "Leave by" is the session start minus the walking minutes minus 15, written in the offset of the session's own start time. The page shows the walking minutes only, so "About N min walk" is the walk, and the note under it says the 15 minutes are allowed for.

The estimate is rough on purpose. It does not know the pedestrian bridges, closed doors or crowds, and the detour factor is one number for the whole Strip. The page says it is an estimate, and the Directions link gives a routed answer.

### Venue in the hand-off view

The hand-off view gives each session a `venue`: the venue name the pass shows (its TERMINAL field), or null when the pass has none. The pass keeps the venue in its fields (an empty text means "Venue not published", which becomes null). The site checks that `venue` is null or a text of 1 to 40 characters. It does not refuse a whole hand-off for a venue name it does not know: that would hide the attendee's passes. An unknown name is looked up in the venue file (names and spelling variants, ignoring case) and, if there is no match, the page says it has no map point for the venue.

## Privacy

In plain English. This is a design record, not legal advice, and we have not had legal advice on it.

- The page says: "Compass does not send your location anywhere or save it. Your phone may use its own location service to find it." The second sentence is there because the browser may ask the phone's own location service (for example Wi-Fi or mobile network lookups run by the phone maker or browser vendor). That is outside Compass and this page cannot control it.
- The location is read in memory on the phone, used for one calculation, and dropped. It is not sent in any request to us or anyone else, not stored (no cookies, local storage or other storage) and not logged. A source test keeps `fetch(` out of everything except the hand-off client.
- The browser asks the attendee for permission, and the page asks only after a tap. Saying no costs nothing: every other part of the board page works.
- The reading is a rough fix (not high accuracy) and a cached fix older than 30 seconds is not reused.
- **POPIA (South Africa)** and **GDPR-style data minimisation.** Both ask that personal data be processed only as far as needed for a stated purpose. The GDPR says personal data must be "adequate, relevant and limited to what is necessary in relation to the purposes for which they are processed" (Article 5(1)(c); text read on gdpr-info.eu, an unofficial copy, because EUR-Lex returned an empty page). The Protection of Personal Information Act has a minimality rule in section 10 along the same lines; we could not read its official text (the gov.za PDF could not be turned into text here), so that is from memory and not re-read against the official text. Compass meets the spirit of that by not collecting the location at all: it never reaches a Compass server, so there is nothing to keep, secure or delete. The purpose is stated on the page next to the button.
- **Maps.** The Directions link opens Apple Maps or Google Maps in a new tab. That app receives the phone's location only when the attendee opens the link, under that company's own terms. The page says so under the link.
- The Privacy page of the site lists this behaviour, and cites this record as its source.

### The edge header

The CloudFront response headers policy in `infra/modules/edge` sent `Permissions-Policy: geolocation=()`, which blocks location for every page, so the button could not work on the live site. It now sends `geolocation=(self)`: only the Compass site itself may ask, and no embedded frame can. The camera, microphone and other entries are unchanged. This is a Terraform change and takes effect only after a reviewed plan is applied.

## Consequences

- The attendee learns roughly how long the walk is, with no account, no tracking and no extra server work.
- The estimate can be wrong by a few minutes either way. If feedback shows it is too short or too long, change the detour factor in one place (`site/src/lib/board/walk-estimate.ts`) and this record.
- The venue file now holds explicit coordinates, so other features can use them. The rules engine ignores them.
- Not confirmed: the estimate has not been compared with real walks on the Strip, and the Apple Maps and Google Maps links have not been tried on a real phone in this work.

## Sources

- Browser Geolocation API (`getCurrentPosition`, permission prompt, secure contexts only): [MDN, Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API).
- Map links: [Apple Maps, Map Links](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html) (`daddr`, `dirflg=w`) and [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) (`api=1`, `destination`, `travelmode=walking`).
- Venue points and walking distances: `data/venues.json` (OpenStreetMap data through the OSRM foot routing service, retrieved 17 October 2026).
- GDPR Article 5(1)(c): read on gdpr-info.eu, 30 October 2026 (unofficial copy of the official text). POPIA section 10: not re-read against the official text.
- Compass: ADR-036 (board page buttons and the device check), `site/src/lib/board/walk-estimate.ts`.
