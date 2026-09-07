import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

function ledgerDirectory(): string | null {
  const configured = process.env.LOCAL_STUDIO_DATA_DIR?.trim();
  if (!configured) return null;
  try {
    const dataDirectory = realpathSync(configured);
    const candidate = path.join(dataDirectory, "pairing-tickets");
    try {
      mkdirSync(candidate, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
    }
    const metadata = lstatSync(candidate);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return null;
    const resolvedLedger = realpathSync(candidate);
    if (path.dirname(resolvedLedger) !== dataDirectory) return null;
    chmodSync(resolvedLedger, 0o700);
    return resolvedLedger;
  } catch {
    return null;
  }
}

function removeExpiredMarkers(directory: string, now: number): void {
  try {
    for (const filename of readdirSync(directory)) {
      const match = /^(\d{13})-([a-f0-9]{64})$/.exec(filename);
      if (!match || Number(match[1]) > now) continue;
      try {
        unlinkSync(path.join(directory, filename));
      } catch {}
    }
  } catch {}
}

function claimTicket(ticket: string, expiresAt: number, now: number): boolean {
  const directory = ledgerDirectory();
  if (!directory) return false;
  removeExpiredMarkers(directory, now);
  const digest = createHash("sha256").update(ticket).digest("hex");
  const marker = path.join(directory, `${expiresAt}-${digest}`);
  try {
    const descriptor = openSync(
      marker,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    closeSync(descriptor);
    return true;
  } catch {
    return false;
  }
}

export function redeemPairingTicket(ticket: string, secret: string): boolean {
  const now = Date.now();
  const [nonce, rawExpiry, rawSignature, ...extra] = ticket.split(".");
  if (extra.length || !nonce || !rawExpiry || !rawSignature) return false;
  if (!/^[A-Za-z0-9_-]{32}$/.test(nonce) || !/^\d{13}$/.test(rawExpiry)) return false;
  const expiresAt = Number(rawExpiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 120_000) {
    return false;
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawSignature)) return false;
  const supplied = Buffer.from(rawSignature, "base64url");
  const expected = createHmac("sha256", secret).update(`${nonce}.${rawExpiry}`).digest();
  if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
    return false;
  }
  const claimTime = Date.now();
  if (claimTime >= expiresAt) return false;
  return claimTicket(ticket, expiresAt, claimTime);
}
