// API Gateway REST proxy integration types, written by hand (no Lambda types package).
// Source: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html

export interface ProxyEvent {
  resource: string;
  httpMethod: string;
  headers: Record<string, string | undefined> | null;
  pathParameters: Record<string, string | undefined> | null;
  queryStringParameters: Record<string, string | undefined> | null;
  body: string | null;
  isBase64Encoded: boolean;
  requestContext: { requestId: string };
}

export interface ProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
}

/** Read a request header by name, ignoring case. The first match wins. */
export function header(event: ProxyEvent, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return undefined;
}
