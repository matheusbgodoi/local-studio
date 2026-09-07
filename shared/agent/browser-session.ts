import { Schema } from "effect";

const BrowserSessionScopeSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
});

export function browserSessionPath(path: string, sessionId?: string): string {
  return sessionId ? `${path}?sessionId=${encodeURIComponent(sessionId)}` : path;
}

export function decodeBrowserSessionId(input: unknown): string | undefined {
  const value = Schema.decodeUnknownSync(BrowserSessionScopeSchema)(input).sessionId?.trim();
  if (value && (value.length > 256 || /[\u0000-\u001f]/.test(value))) {
    throw new Error("Invalid browser session identifier");
  }
  return value || undefined;
}
