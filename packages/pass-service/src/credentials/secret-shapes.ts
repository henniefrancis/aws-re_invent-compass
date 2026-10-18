// The JSON layout of the three secrets (design, Data Models). These keys are the S6
// interface: scripts/load-secrets.sh and the Terraform secret containers must match.
import { z } from 'zod';

const LABEL = /^[A-Za-z0-9._-]{1,64}$/;

export const AppSecretSchema = z.object({
  pepper: z.string().min(16),
  /** A short label for the pepper in use. Not secret; stored on every record. */
  pepperId: z.string().regex(LABEL),
});

/** Its own secret, so the origin-verify value can rotate without touching the pepper. */
export const OriginSecretSchema = z.object({
  originVerify: z.string().min(16),
  /** Set only while the origin-verify value is being rotated. */
  originVerifyPrevious: z.string().min(16).optional(),
});

export const AppleSecretSchema = z.object({
  passTypeIdentifier: z.string().min(1),
  teamIdentifier: z.string().min(1),
  signerCertPem: z.string().min(1),
  signerKeyPem: z.string().min(1),
  signerKeyPassphrase: z.string(),
  wwdrPem: z.string().min(1),
});

export const GoogleSecretSchema = z.object({
  issuerId: z.string().regex(LABEL),
  serviceAccount: z.object({
    client_email: z.string().min(1),
    private_key: z.string().min(1),
  }),
});

export type AppSecret = z.infer<typeof AppSecretSchema>;
export type OriginSecret = z.infer<typeof OriginSecretSchema>;
export type AppleSecret = z.infer<typeof AppleSecretSchema>;
export type GoogleSecret = z.infer<typeof GoogleSecretSchema>;
