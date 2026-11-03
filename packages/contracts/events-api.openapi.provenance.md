# Events API OpenAPI document: provenance

`events-api.openapi.json` in this folder is the official AWS Events API OpenAPI document, committed byte for byte as fetched. Every Events API type in Compass is generated from it, and CI never calls the live API, so this record proves which document it is. The decision behind it is on the wiki: [the Events API contract pinned in the repository](https://github.com/henniefrancis/aws-re_invent-compass/wiki/Decisions-Architecture#the-events-api-contract-pinned-in-the-repository).

- Committed path: `packages/contracts/events-api.openapi.json`
- Source URL: https://api.awsevents.com/v1/openapi.json
- Retrieval date (UTC, ISO 8601): 2026-10-31 (first retrieved 2026-10-15)
- OpenAPI version: 3.1.0
- Document title and version: "AWS Events API", version 1.0.0
- Byte size: 100728 bytes
- SHA-256 (hex): 2688566112c6205379fe15011e72512c5f0ff5c575b4c1e608e932eb5bb03f94

Refresh of 31 October 2026 (foundation-contracts task 23): the live document changed only in three `PersonalTime` descriptions. Personal time is now documented as wall-clock time in the event's own time zone, not UTC, and a block must end on the same date it starts. The previous SHA-256 was b8591c1bb9bcf9f40871f3af19b8418f39fc527f7e8692e7ef1d533ca9638d82.

## Refreshing the document

Only an operator refreshes it, by rerunning [scripts/fetch-events-api.mjs](scripts/fetch-events-api.mjs). A refresh that changes the document updates the SHA-256 above in the same change. `test/events-api-provenance.test.ts` fails if the first SHA-256 in this file is not the hash of the committed document, or if the source URL is missing.
