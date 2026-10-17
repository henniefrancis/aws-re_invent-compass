// Verifies the detached PKCS #7 signature of a pass without node-forge: the DER is parsed
// by hand and the signature is checked with node:crypto (security review: tests never use
// node-forge to verify a signature).
import { X509Certificate, createHash, verify } from 'node:crypto';

interface Tlv {
  tag: number;
  start: number;
  contentStart: number;
  end: number;
}

function readTlv(buffer: Buffer, offset: number): Tlv {
  const tag = buffer.readUInt8(offset);
  const first = buffer.readUInt8(offset + 1);
  let length = first;
  let contentStart = offset + 2;
  if (first >= 0x80) {
    const count = first & 0x7f;
    length = 0;
    for (let i = 0; i < count; i += 1) {
      length = length * 256 + buffer.readUInt8(offset + 2 + i);
    }
    contentStart = offset + 2 + count;
  }
  return { tag, start: offset, contentStart, end: contentStart + length };
}

function children(buffer: Buffer, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let offset = parent.contentStart;
  while (offset < parent.end) {
    const child = readTlv(buffer, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}

/** DER of the messageDigest attribute type (1.2.840.113549.1.9.4). */
const MESSAGE_DIGEST_OID = Buffer.from('06092a864886f70d010904', 'hex');

export interface Pkcs7Check {
  /** The messageDigest attribute equals the SHA-1 of the content. */
  digestMatches: boolean;
  /** The signature over the signed attributes verifies with the given certificate. */
  signatureValid: boolean;
  /** Certificates carried in the signature. */
  certificates: X509Certificate[];
}

export function checkDetachedSignature(
  signature: Uint8Array,
  content: Uint8Array,
  signerCertificatePem: string,
): Pkcs7Check {
  const buffer = Buffer.from(signature);
  const root = readTlv(buffer, 0);
  const explicit = children(buffer, root)[1] as Tlv;
  const signedData = children(buffer, explicit)[0] as Tlv;
  const parts = children(buffer, signedData);
  const certificateSet = parts.find((part) => part.tag === 0xa0) as Tlv;
  const certificates = children(buffer, certificateSet).map(
    (cert) => new X509Certificate(buffer.subarray(cert.start, cert.end)),
  );
  const signerInfos = parts[parts.length - 1] as Tlv;
  const signerInfo = children(buffer, children(buffer, signerInfos)[0] as Tlv);
  const attributes = signerInfo.find((part) => part.tag === 0xa0) as Tlv;
  const encryptedDigest = signerInfo[signerInfo.length - 1] as Tlv;

  // The signature covers the attributes as a DER SET (tag 0x31), not the [0] implicit form.
  const signedAttributes = Buffer.from(buffer.subarray(attributes.start, attributes.end));
  signedAttributes[0] = 0x31;

  const attribute = children(buffer, attributes).find((attr) =>
    buffer.subarray(attr.start, attr.end).includes(MESSAGE_DIGEST_OID),
  ) as Tlv;
  const valueSet = children(buffer, attribute)[1] as Tlv;
  const digestOctets = children(buffer, valueSet)[0] as Tlv;
  const digest = buffer.subarray(digestOctets.contentStart, digestOctets.end);

  const publicKey = new X509Certificate(signerCertificatePem).publicKey;
  return {
    digestMatches: digest.equals(createHash('sha1').update(content).digest()),
    signatureValid: verify(
      'sha1',
      signedAttributes,
      publicKey,
      buffer.subarray(encryptedDigest.contentStart, encryptedDigest.end),
    ),
    certificates,
  };
}
