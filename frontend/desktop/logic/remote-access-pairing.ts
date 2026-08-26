import { createHmac, randomBytes } from "node:crypto";

const PAIRING_TICKET_LIFETIME_MS = 120_000;

export function createRemoteAccessPairingTicket(secret: string): string {
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + PAIRING_TICKET_LIFETIME_MS;
  const payload = `${nonce}.${expiresAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
