// The HTTP seam the pass client talks through. These are S4's own types, re-exported so the
// in-process pass service and the fetch transport implement exactly what the client calls:
// a request with a string body and an optional `binary` flag, and a response with a string
// body, lower-cased header names and raw `bytes` for a binary download.

export type { HttpRequest, HttpResponse, HttpTransport } from '@compass/core/passes';
