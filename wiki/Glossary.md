_For everyone: the words used across this wiki, from the airline metaphor to the AWS services, each in a few plain sentences with a link to the page that explains more._

Compass borrows the language of air travel. A [venue](#venue) is a terminal, a room is a gate, a session title is a flight name, the seat release 10 minutes before the start is when boarding closes, favourites are standby, personal time is a layover, and a repeat session is the rebooking. The rest of the terms are the tools and AWS services behind it.

## A to Z

### API Gateway

Amazon API Gateway, the AWS service that receives Compass API requests from [CloudFront](#cloudfront). It checks the API key and validates each request against the contract before it calls a [Lambda](#lambda) function. See [AWS architecture](AWS-Architecture).

### APNs

Apple Push Notification service. When a pass changes, the pass service sends an empty push through APNs to each registered iPhone, and [Wallet](#wallet) then fetches the new pass. See [Pass service](Pass-Service).

### Attendee

A person going to AWS re:Invent 2026, and the person Compass is built for. In the airline metaphor, the passenger. See [User guide: Plan](User-Guide-Plan).

### AWS Builder ID

The personal AWS sign-in that re:Invent uses. Compass signs you in with it in your browser: the access token goes only to the [Events API](#events-api), and the ID token only to the [Compass API](#compass-api) as proof that you signed in. See [Security](Security).

### Boarding closes

The moment a reserved seat is released: 10 minutes before the session starts. Compass plans every walk to arrive by then, and every [boarding pass](#boarding-pass) shows it. See [Guardrail rules](Guardrail-Rules).

### Boarding pass

An unofficial Apple Wallet or Google Wallet pass for one reserved session, laid out like an airline boarding pass. It updates when the session changes, is [voided](#void) when you cancel, and expires when the session ends. Your badge, not the pass, is your ticket. See [User guide: Fly](User-Guide-Fly).

### CloudFront

Amazon CloudFront, the content delivery network in front of everything at reinvent-compass.vegas. It serves the site and sends `/api/*` to [API Gateway](#api-gateway), adding the origin headers that viewers never see. See [AWS architecture](AWS-Architecture).

### Compass API

The project's own small HTTPS API on AWS, also called the pass API. It signs and updates [boarding passes](#boarding-pass), runs the [PassKit](#passkit) web service and serves the [hand-off](#hand-off). See [Pass API](Pass-API).

### Connection

The walk between two commitments in a row, from one [terminal](#terminal) to the next. Compass adds the walking time and a buffer, and checks you reach the next [gate](#gate) before [boarding closes](#boarding-closes). See [Guardrail rules](Guardrail-Rules).

### DynamoDB

Amazon DynamoDB, the on-demand database of the pass service. It holds pass records, device registrations, hand-offs and rate counters, and deletes old items by [TTL](#ttl). See [Data and privacy](Data-and-Privacy).

### Energy budget

A score for how hard a day is: 10 points per commitment, plus the walking minutes, plus 15 points per change of [venue](#venue). Above 100 the day is overloaded and Compass warns you. See [Guardrail rules](Guardrail-Rules).

### Events API

The AWS re:Invent 2026 Event Catalog API at `api.awsevents.com`. Its 12 operations read the catalog and read or change your own schedule. See [Events API coverage](Events-API-Coverage).

### Flight name

The session title, printed as FLIGHT NAME at the top of the [boarding pass](#boarding-pass), above the [terminal](#terminal) and [gate](#gate). See [User guide: Fly](User-Guide-Fly).

### Gate

The room a session is in, printed as GATE on the [boarding pass](#boarding-pass). See [User guide: Fly](User-Guide-Fly).

### GitHub App

The read-only "re:Invent Compass (unofficial)" GitHub App. It has only Contents: read and Metadata: read, so Compass can scan your repositories for technology but can never change them. See [MCP tools](MCP-Tools).

### Guardrail

The check every booking passes before Compass makes it: clashes, [connections](#connection), [boarding closes](#boarding-closes), meal breaks and the [energy budget](#energy-budget). It answers allow, warn or block with a plain reason, and the MCP server, the [Kiro hook](#kiro-hook) and the site demo share one implementation. See [Guardrail rules](Guardrail-Rules).

### Hand-off

A 15-minute link, with an optional QR code, that moves your [boarding passes](#boarding-pass) from your computer to your phone. The id travels in the URL fragment, and an expired or unknown link answers not found. See [User guide: Fly](User-Guide-Fly).

### HCP Terraform

HashiCorp's hosted [Terraform](#terraform) service. It runs the Compass plans and applies, one workspace per environment, and reaches AWS through [OIDC](#oidc), so no long-lived AWS key is stored. See [Release](Release).

### Kiro

AWS's agentic development environment, which builds software from specs, [steering](#steering) and hooks. Compass was built with Kiro and ships for it as a [Kiro Power](#kiro-power). See [How it was built](How-It-Was-Built).

### Kiro hook

An action Kiro runs when something happens, such as a file save or a tool call. The Compass hook template runs the [guardrail](#guardrail) before a booking and blocks the write tools of the official Events API server. See [Steering and hooks](Steering-and-Hooks).

### Kiro Power

A package that adds an [MCP server](#mcp-server), skills and hooks to Kiro in one install. The Compass Power starts the Compass MCP server with `npx --yes reinvent-compass@0.1.3`. See [Kiro Power](Kiro-Power).

### Kiro spec

A set of three Kiro documents for one feature: requirements, design and tasks. Compass is built from eight specs, and `plan_week` writes your week as a spec too. See [Kiro specs](Kiro-Specs).

### Lambda

AWS Lambda, which runs the pass service code without servers. There are two functions, `api` and `passkit`, on Node.js 24. See [Pass service](Pass-Service).

### Layover

Personal time on your schedule for a meal, water or rest, like the time between two flights. Compass suggests one when a day has no meal break or too long a stretch, and saves it as personal time on the [Events API](#events-api). See [Guardrail rules](Guardrail-Rules).

### MCP

The Model Context Protocol: the open standard that lets an AI assistant call tools offered by a server. See [MCP server](MCP-Server).

### MCP client

The AI app that connects to an [MCP server](#mcp-server) and calls its tools with your approval, such as Kiro. See [Getting started](Getting-Started).

### MCP server

A program that offers tools over [MCP](#mcp). The Compass MCP server runs on your own machine over stdio and is the npm package `reinvent-compass`. See [MCP server](MCP-Server).

### OIDC

OpenID Connect, an identity layer on OAuth 2.0. Builder ID ID tokens are OIDC tokens, and [HCP Terraform](#hcp-terraform) and the npm publish workflow use OIDC to get short-lived credentials instead of stored keys. See [Security](Security).

### OpenAPI

The standard format for describing an HTTP API. The [Compass API](#compass-api) and the [Events API](#events-api) are both OpenAPI documents, and Compass generates its types from them. See [Contracts](Contracts).

### PassKit

Apple's framework and web service protocol for Wallet passes. The `passkit` Lambda implements the five routes an iPhone uses to register for and fetch pass updates. See [Pass API](Pass-API).

### PKCE

Proof Key for Code Exchange, the OAuth 2.0 extension that makes a sign-in from a desktop app safe without a client secret. Compass uses a fresh verifier and state for every sign-in attempt. See [Security](Security).

### Read-only mode

The default in live mode: Compass reads your real schedule but changes nothing, and each booking tool says what it would do instead. Set `COMPASS_ALLOW_WRITES=1` to turn writes on. See [Read-only by default](Read-Only-By-Default).

### Repeat

Another offering of the same session at a different time, marked `-R`, `-R1`, `-R2` and so on after the code. It is the rebooking: a later flight on the same route. See [Guardrail rules](Guardrail-Rules).

### Safe swap

Moving from a session to its [repeat](#repeat) without risk: reserve the repeat, confirm it on your schedule, then cancel the original. Compass never cancels first. See [Guardrail rules](Guardrail-Rules).

### Session code

The catalog code of a session, such as `DAT302` or its repeat `DAT302-R`. Compass accepts a code wherever a tool takes a session id. See [MCP tools](MCP-Tools).

### Simulated mode

Compass running on made-up data with `COMPASS_MODE=simulated`: the [synthetic catalog](#synthetic-catalog), a signed-in attendee and an in-process pass service, with no network. Every result starts with `SIMULATED MODE: no real data.` See [Build and test](Build-and-Test).

### Standby

Your favourites list on the [Events API](#events-api), used as backup sessions, like standby on a full flight. See [User guide: Board](User-Guide-Board).

### Steering

Markdown files in [.kiro/steering](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/.kiro/steering) that Kiro reads in every session: the product, tech, structure and workflow rules of the project. See [Steering and hooks](Steering-and-Hooks).

### Synthetic catalog

120 made-up sessions in the real Events API shape, generated the same way every time. Tests, the demo and [simulated mode](#simulated-mode) use it, so no test touches live data. See [Build and test](Build-and-Test).

### Tech list

The AWS services and other technology Compass has found in your folders and GitHub repositories, kept only on your machine. It drives `plan_week` and `find_sessions_by_tech`. See [Privacy](Privacy).

### Terminal

The [venue](#venue) of a session, printed as TERMINAL on the [boarding pass](#boarding-pass). See [User guide: Fly](User-Guide-Fly).

### Terraform

HashiCorp's infrastructure as code tool. All of the Compass AWS infrastructure is Terraform; there are no console steps. See [AWS architecture](AWS-Architecture).

### Tight connection

A [connection](#connection) that leaves less than 5 minutes to spare before you are due at the next session: when [boarding closes](#boarding-closes) for a reserved seat, otherwise its start. Compass warns but does not block. See [Guardrail rules](Guardrail-Rules).

### TTL

Time to live: a [DynamoDB](#dynamodb) attribute, `ttl`, that holds when an item may be deleted. Pass records, hand-offs and rate counters carry one, so data does not outlive its use. See [Data and privacy](Data-and-Privacy).

### Venue

One of the six re:Invent 2026 venues: Caesars Forum, Caesars Palace, Encore, MGM Grand, The Venetian and Wynn. The pass shows it as the [terminal](#terminal). See [Guardrail rules](Guardrail-Rules).

### Void

To mark a [boarding pass](#boarding-pass) as no longer valid, like a cancelled ticket: Apple Wallet shows it voided and Google Wallet shows it inactive. Compass voids a pass when its session is no longer reserved and you sync. See [User guide: Fly](User-Guide-Fly).

### WAF

AWS WAF, the web application firewall on the [CloudFront](#cloudfront) distribution. It limits requests per IP address, blocks request bodies over 64 KB on the API and applies AWS managed rule sets. See [AWS architecture](AWS-Architecture).

### Walk-up

The line for people without a reservation. A walk-up option is a session that needs no reservation, or is full, so you can queue for a seat; Compass lists it as a rebooking choice. See [Guardrail rules](Guardrail-Rules).

### Wallet

Apple Wallet on iPhone or Google Wallet on Android, where your [boarding passes](#boarding-pass) live. See [User guide: Fly](User-Guide-Fly).

## Related pages

- [Home](Home)
- [Getting started](Getting-Started)
- [Guardrail rules](Guardrail-Rules)
- [FAQ](FAQ)
