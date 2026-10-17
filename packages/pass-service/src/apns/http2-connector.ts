// The HTTP/2 connection to APNs, authenticated with the Pass Type ID certificate and key
// (certificate-based trust: the provider certificate is presented in the TLS handshake).
// Docs: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
import { connect, type ClientHttp2Session } from 'node:http2';

export interface TlsCredentials {
  cert: string;
  key: string;
  passphrase?: string;
}

export interface Http2Connector {
  connect(host: string, tls: TlsCredentials): ClientHttp2Session;
}

export interface ConnectorOptions {
  /** Defaults to 443. Overridden only by the loopback tests. */
  port?: number;
  /** Extra trusted CA. Used only by the loopback test server. */
  ca?: string;
}

export function createHttp2Connector(options: ConnectorOptions = {}): Http2Connector {
  const port = options.port ?? 443;
  return {
    connect(host, tls) {
      return connect(`https://${host}:${port}`, {
        cert: tls.cert,
        key: tls.key,
        ...(tls.passphrase === undefined ? {} : { passphrase: tls.passphrase }),
        ...(options.ca === undefined ? {} : { ca: options.ca }),
        minVersion: 'TLSv1.2',
      });
    },
  };
}
