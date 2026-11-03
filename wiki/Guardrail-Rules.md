_For attendees (and anyone checking the logic): every rule the booking guardrail applies, with its exact numbers, the walking times between venues, and the safe swap._

The [guardrail](Glossary#guardrail) answers one question: should this booking go ahead? One function, `checkReservation` in [packages/core/src/rules/check-reservation.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/src/rules/check-reservation.ts), answers it everywhere: in the Compass MCP server, in the Kiro hook and in the browser demo. It never reads a clock, a file or the network; the caller passes in the current time, the event time zone and the venue data.

It returns **allow**, **warn** or **block**, with one plain-English reason for each rule that applied:

- **block** if any block rule applies;
- otherwise **warn** if any warn rule applies or any rule could not be judged;
- otherwise **allow**.

The reasons below are quoted from [packages/core/src/rules/reasons.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/src/rules/reasons.ts). Names in a reason are cut to four words and 30 characters.

## The rules at a glance

| Rule                                     | Outcome               |
| ---------------------------------------- | --------------------- |
| Clash with something you hold            | Block                 |
| Connection certainly impossible          | Block                 |
| Connection likely impossible             | Warn                  |
| Tight connection                         | Warn                  |
| Removes the day's only meal break        | Warn                  |
| Pushes the day over the energy limit     | Warn                  |
| Session already over, or boarding closed | Warn                  |
| No seats left                            | Warn                  |
| A rule cannot be judged (missing data)   | Warn, naming the rule |
| The check itself fails                   | Block                 |

## The numbers

Every tuning value has one default in [packages/core/src/rules/context.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/src/rules/context.ts):

| Setting                  | Default        | Accepted range  | Used by                                          |
| ------------------------ | -------------- | --------------- | ------------------------------------------------ |
| Boarding offset          | 10 minutes     | fixed           | Boarding closes                                  |
| `bufferMinutes`          | 10             | 0 to 120        | Connections                                      |
| `tightMarginMinutes`     | 5              | 0 to 60         | Connections                                      |
| `mealWindow`             | 11:30 to 14:00 | end after start | Meals                                            |
| `requiredFreeMinutes`    | 30             | 0 to 1440       | Meals                                            |
| `maxStretchMinutes`      | 180            | 1 to 1440       | Rest                                             |
| `overloadThreshold`      | 100            | above 0         | Energy                                           |
| `overloadCountThreshold` | 6              | above 0         | A count-only fallback, not used by the guardrail |

A setting outside its range never turns into a verdict: the check answers warn with "The setting "..." is not valid. The reservation could not be checked."

## Boarding closes

A reserved seat is held only until 10 minutes before the session starts; after that it can go to the [walk-up](Glossary#walk-up) line. [Boarding closes](Glossary#boarding-closes) is that moment ([packages/core/src/rules/boarding.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/src/rules/boarding.ts)).

- It is the start minus 10 minutes, worked out on the instant and then shown in the event time zone, so a change of clock offset can never shift it.
- A session that needs no reservation has no boarding time: "This session needs no reservation, so it has no boarding time."
- Whether a session needs a reservation comes only from its reservation flag, never from its type name.

## Clashes

Two commitments clash when they overlap by one second or more ([packages/core/src/rules/clashes.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/src/rules/clashes.ts)).

- Two commitments with identical start and end clash.
- Touching at a single instant (one ends at 10:00, the next starts at 10:00) is not a clash. The connection rule judges that case.
- An all-day item covers 00:00:00 to 23:59:59 of its day in the event time zone.
- A commitment that crosses midnight is judged on its real start and end.
- A commitment with no usable end time cannot be checked; it is reported, not guessed.

A clash **blocks**, with a reason such as `"A" and "B" overlap from 10:00 to 10:30.`

## Connections

A connection is the walk from one commitment to the next ([packages/core/src/rules/connections.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/src/rules/connections.ts)). The guardrail checks the walk from the nearest commitment before the new session, and to the nearest one after it, each within 12 hours (across midnight).

```text
due time      = boarding closes of the next session (or its start, if it needs no reservation)
walk          = walking minutes from the venue data + extra buffer
arrival       = end of the previous commitment + walk
spare minutes = due time - arrival
```

**The buffer.** Every walk in the venue data is an estimate that already includes 15 minutes to leave one building and enter the next. So only the buffer above those 15 minutes is added: with the default 10 minute buffer, nothing is added. An official walking time would get the whole buffer. Two places in the same venue are a 5 minute walk (an estimate).

| Spare minutes                                           | Class                              | Outcome                                                                                  |
| ------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| 5 or more                                               | comfortable                        | allow                                                                                    |
| 0 to under 5                                            | [tight](Glossary#tight-connection) | warn: "Tight connection. ..."                                                            |
| below 0, but you would make it at half the walk         | likely impossible                  | warn: "Likely impossible connection. ... The walk is an estimate, so check it yourself." |
| below 0, even at half the walk, or the walk is official | impossible                         | block: "Impossible connection. ..."                                                      |
| a venue, time or walk is missing                        | unknown                            | warn, as missing data                                                                    |

Because the walking times are estimates, an impossible walk only blocks when you would be late even if the walk took half as long.

**Worked examples** (the default settings, a session that ends at 10:00 at the first venue, then a reserved session at the second; real output of the rules engine):

| From, to                             | Next starts | Boarding closes | Arrive | Result                                                                                                 |
| ------------------------------------ | ----------- | --------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Caesars Forum, The Venetian (30 min) | 10:45       | 10:35           | 10:30  | allow, 5 minutes spare                                                                                 |
| Caesars Forum, The Venetian          | 10:43       | 10:33           | 10:30  | warn: "That leaves only 3 minutes to spare."                                                           |
| Caesars Forum, The Venetian          | 10:30       | 10:20           | 10:30  | warn, likely impossible: "You would arrive 10 minutes late." (at half the walk you would arrive 10:15) |
| Caesars Forum, The Venetian          | 10:20       | 10:10           | 10:30  | block: "You would arrive 20 minutes late." (late even at half the walk)                                |
| MGM Grand, MGM Grand (5 min)         | 10:00       | 09:50           | 10:05  | block: "You would arrive 15 minutes late."                                                             |
| MGM Grand, MGM Grand                 | 10:30       | 10:20           | 10:05  | allow                                                                                                  |

The last two rows matter for first-timers: a reserved session that starts the moment your last one ends, even in the same building, is blocked, because its seat is released 10 minutes before the start.

A full connection reason reads: "The walk from "Caesars Forum" to "The Venetian" is 30 minutes, an estimate. It includes time to leave and enter buildings. No extra buffer is added, so you need 30 minutes. That leaves only 3 minutes to spare."

## Walking estimates

AWS publishes no walking times between venues, so [data/venues.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/data/venues.json) holds researched estimates for every ordered pair of the six official 2026 venues: 30 walking times, 15 pairs, the same in both directions. Each estimate states its basis and sources in the file.

**The formula:**

```text
minutes = round up to the next 5 ( OSRM foot distance in metres / 66.7 metres a minute + 15 )
minutes = at least 30
```

- The distance is the OpenStreetMap foot route from the public OSRM router.
- 66.7 metres a minute is a walking pace of about 4 km an hour.
- 15 minutes covers getting out of one building and into the next.
- The 30 minute floor is the low end of the AWS advice to allow 30 to 45 minutes when walking between or within venues.

### The six venues

| Venue          | Also matched as                            |
| -------------- | ------------------------------------------ |
| Caesars Forum  |                                            |
| Caesars Palace |                                            |
| Encore         |                                            |
| MGM Grand      |                                            |
| The Venetian   | Venetian, The Venetian Expo, Venetian Expo |
| Wynn           | Wynn Las Vegas                             |

The venue names come from the official re:Invent FAQ. The map point of each venue is an OpenStreetMap estimate of a point on the resort, not a door, and not an official AWS location. A venue that is not in this list makes a connection unknown.

### The 15 pairs

| Venue A        | Venue B        | Foot distance (m) | Distance / 66.7 (min) | Estimate (min) |
| -------------- | -------------- | ----------------: | --------------------: | -------------: |
| Caesars Forum  | Caesars Palace |             1,614 |                  24.2 |             40 |
| Caesars Forum  | Encore         |             1,875 |                  28.1 |             45 |
| Caesars Forum  | MGM Grand      |             2,423 |                  36.3 |             55 |
| Caesars Forum  | The Venetian   |               894 |                  13.4 |             30 |
| Caesars Forum  | Wynn           |             1,731 |                  26.0 |             45 |
| Caesars Palace | Encore         |             2,646 |                  39.7 |             55 |
| Caesars Palace | MGM Grand      |             2,867 |                  43.0 |             60 |
| Caesars Palace | The Venetian   |             2,532 |                  38.0 |             55 |
| Caesars Palace | Wynn           |             2,502 |                  37.5 |             55 |
| Encore         | MGM Grand      |             3,988 |                  59.8 |             75 |
| Encore         | The Venetian   |             1,727 |                  25.9 |             45 |
| Encore         | Wynn           |               622 |                   9.3 |     30 (floor) |
| MGM Grand      | The Venetian   |             2,958 |                  44.3 |             60 |
| MGM Grand      | Wynn           |             3,844 |                  57.6 |             75 |
| The Venetian   | Wynn           |             1,583 |                  23.7 |             40 |

For example, Caesars Forum to Caesars Palace: 1614 / 66.7 = 24.2, plus 15 is 39.2, rounded up to 40. Encore to Wynn comes to 25, so the 30 minute floor applies. Same venue, room to room: 5 minutes.

## Meals

Each day needs at least 30 free minutes, in total, inside the meal window of 11:30 to 14:00 in the event time zone ([packages/core/src/rules/layovers.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/src/rules/layovers.ts)). Free means not overlapping any commitment.

- The guardrail **warns** only when the booking takes the day from having a meal break to having none: "This removes your only meal break on 2026-12-02."
- When planning, Compass suggests a 30 minute meal [layover](Glossary#layover) in the clash-free gap nearest the window ("Take a meal break in this gap."), or says "No clash-free gap was found for a meal block."
- All-day items are left out of this check.

## Rest

A run of commitments with no gap between them (touching or overlapping) that is longer than 180 minutes is flagged: "On 2026-12-02 you have 240 minutes without a break. The limit is 180 minutes." Compass then suggests a 15 minute rest layover right after the stretch, or right before it when the gap after is not clear.

This is a planning check, used by `plan_week` and the demo. It does not change a booking verdict.

## Energy

Each day gets an [energy](Glossary#energy-budget) score you can read ([packages/core/src/rules/energy.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/src/rules/energy.ts)):

```text
energy = (commitments x 10) + walking minutes + (venue changes x 15)
```

- **Commitments** are everything on the day, sessions and layovers.
- **Walking minutes** are the walks between consecutive commitments, in time order (the estimate, with the same buffer rule as connections).
- **Venue changes** are consecutive pairs at different venues.
- A day is **overloaded** when the score is above 100.

The guardrail **warns** only when the booking takes the day from not overloaded to overloaded. Example, real output: Caesars Forum, then The Venetian, then Caesars Forum again: "This makes 2026-12-01 too busy. Energy score is 120: 3 commitments times 10, 60 walking minutes, 2 venue changes times 15. Formula: commitments times 10 plus walking minutes plus venue changes times 15. That is above the limit of 100, so the day is overloaded. The walking minutes are estimates."

A commitment with no venue or time is counted but left out of the walking and venue totals, and the explanation names it. Personal time with no location counts as staying where you are.

## Timing and seats

- **Already over:** `"X" has already ended. It is in the past.` (warn)
- **Boarding has closed:** `Boarding has already closed for "X". A reserved seat would go to the walk-up line.` (warn)
- **No seats:** a session whose seats are `unavailable` or walk-up only: `"X" has no seats left. You would have to join the walk-up line.` (warn)
- **Seats unknown:** never read as available: `The seat availability of "X" is unknown. Do not count on a seat.` (missing data, warn)

## Missing data

Any session field from the [Events API](Glossary#events-api) may be missing, and Compass never fills a gap with an invented value. A rule that cannot be judged is skipped, never blocked on, and the verdict is at least warn with a reason that names the rule:

"The connection check could not be judged because data was missing. The venue for "X" is missing. The connection is unknown."

The rule names are: clash check, connection check, meal break check, energy check, timing check and seat check. If the event time zone is missing or not recognised, the four time rules (clash, connection, meal and energy) are all skipped this way.

## When the check itself fails

- An unexpected error inside the check gives **block**: "An internal error stopped the check. The reservation is blocked to be safe."
- A schedule with more than 200 commitments, or more than 2,000 sessions to look up, gives **warn**, never allow.

## Other ways to attend

When a session is blocked or full, Compass looks for other ways to get the same content ([packages/core/src/rules/rebooking.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/src/rules/rebooking.ts)). It offers only sessions that start after now, each listed once, in this order:

| Kind    | What it is                                                        | Reason text                                                                         |
| ------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| repeat  | The same base code with `-R`, `-R1`, `-R2` and so on, in any case | `Repeat "X" starts ...`                                                             |
| standby | A session with the same base code that you favourited as a backup | `You favorited "X" as a backup. It starts ...`                                      |
| walk-up | A showing that needs no reservation or has no seats left          | `"X" is full, so join the walk-up line.` or `"X" needs no reservation, so walk up.` |

The base code is the code without its trailing `-R` part. `ABC123-R1` and `ABC123-R3` are repeats of each other even when `ABC123` does not exist. An `-S` code is a different session: `ABC123-S` is never a repeat of `ABC123`.

## The safe swap

Moving to a [repeat](Glossary#repeat) must never leave you with neither seat ([packages/core/src/rules/safe-swap.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/src/rules/safe-swap.ts)). A [safe swap](Glossary#safe-swap) always has three steps, in order:

1. "Reserve the repeat "X" first."
2. "Read the schedule back and check that the repeat is held."
3. "Do not cancel the original until the repeat is confirmed and safe." or, once it is, "The repeat is confirmed. You can cancel the original now."

The swap is judged on the schedule read back after step 1:

| Outcome | When                                                                                                                                                                                                                                                                                                            | Cancel allowed |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| safe    | The repeat is held, clashes with nothing, the original is still in the schedule, and no neighbouring walk is certainly impossible                                                                                                                                                                               | Yes            |
| unsafe  | The repeat clashes with the original or another commitment; each one is named                                                                                                                                                                                                                                   | No             |
| failed  | The schedule does not show the repeat as held                                                                                                                                                                                                                                                                   | No             |
| unknown | The time zone, the current time or the repeat's times are unusable; the repeat is not another showing of the original (a different base code, or the same session); the repeat has already ended; the original is missing; a neighbouring walk is certainly impossible; or another commitment cannot be checked | No             |

"Safe" does not mean the walks are comfortable, or that seats are free. Every outcome but safe ends with "The original stays unchanged."

**When Compass offers one.** If a booking is blocked by a clash with a session you hold, Compass looks for the first repeat of that held session that would not itself be blocked once the original is gone and the new session is added. If it finds one, the reply offers the swap: reserve the repeat, confirm it, cancel the original, then reserve the session you wanted.

**Cancelling during a swap.** `cancel_reservation` on the original runs the safe swap check on a fresh schedule and cancels only when it is safe. If not, the first request is refused. A second request gets a confirmation: "Cancel anyway? Your repeat seat is not confirmed, so you could end up with neither seat." A client that cannot ask for confirmation never gets that override; it is refused until the repeat is confirmed on your schedule.

## Where the guardrail runs

| Where                     | When                                                                                                                     | If it cannot judge                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| The Compass MCP server    | Every `check_itinerary`, `reserve_with_guardrails`, `plan_week` and swap, on a fresh schedule                            | Warns, as above                                |
| The Kiro hook (Kiro only) | Before a `reserve_with_guardrails` call, against the last schedule read (if under 15 minutes old) and the cached catalog | Lets the call through; the server checks again |
| The browser demo          | Every session you add on [reinvent-compass.vegas/demo](https://reinvent-compass.vegas/demo)                              | Shows the reason                               |

The hook is defence in depth: the server checks every booking itself, in every client. In [read-only mode](Read-Only-By-Default) the server still runs every check and then changes nothing.

## Related pages

- [Plan: booking behind the guardrail](User-Guide-Plan#book-it-behind-the-guardrail)
- [Read-only by default](Read-Only-By-Default)
- [Glossary](Glossary)
- [MCP tools](MCP-Tools)
- [Architecture overview](Architecture-Overview)
