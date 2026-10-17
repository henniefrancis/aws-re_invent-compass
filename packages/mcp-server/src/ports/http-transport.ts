// The HTTP seam the pass client talks through (S4 `HttpTransport`). The shapes here follow
// the design's "request(req) => response" description; task 26 aligns them with S4's exact
// types. The in-process pass service and the fetch transport both implement it, so simulated
// mode never opens a socket and live mode uses fetch with https only.

/** An outgoing request. */
export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
}

/** A response. The body is bytes so a `.pkpass` download is not corrupted. */
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** Sends one request. Throws a CompassError when the service cannot be reached. */
export interface HttpTransport {
  request(request: HttpRequest): Promise<HttpResponse>;
}
