// Recognising "this site wants a human, not a script" — and nothing else.
//
// The whole point of detecting a challenge is to STOP: stop retrying, stop
// rotating anything, hand the page to the owner and wait. So the cost of a false
// positive is a page the model refuses to read for no reason, and the cost of a
// false negative is a retry loop against a site that has already said no.
//
// That asymmetry is why this is deliberately conservative. A news article about
// CAPTCHAs contains the word "captcha" many times; a challenge page contains a
// challenge WIDGET. Prose is never enough on its own - a marker must be present,
// or a challenge phrase must appear in a page whose entire body is short enough
// that it cannot be an article.
//
// NOT IMPLEMENTED, ON PURPOSE: any form of solving. No CAPTCHA service, no OCR,
// no audio transcription, no fingerprint spoofing, no proxy rotation, no token
// replay. This module can only ever answer "a human is needed here".

export type ChallengeProvider =
  | "recaptcha"
  | "hcaptcha"
  | "turnstile"
  | "cloudflare"
  | "generic";

export type ChallengeDetection = {
  verificationRequired: true;
  provider: ChallengeProvider;
  site: string;
  url: string;
  reason: string;
};

export type ChallengeInput = {
  url: string;
  status?: number;
  title?: string;
  text?: string;
  html?: string;
};

// Widget/interstitial fingerprints. Each of these is markup a page only carries
// when it is actually serving a challenge.
const MARKERS: Array<{ provider: ChallengeProvider; pattern: RegExp; reason: string }> = [
  { provider: "recaptcha", pattern: /\bg-recaptcha\b|www\.google\.com\/recaptcha\/|\bgrecaptcha\./i, reason: "reCAPTCHA widget on the page" },
  { provider: "hcaptcha", pattern: /\bh-captcha\b|\bhcaptcha\.com\b/i, reason: "hCaptcha widget on the page" },
  { provider: "turnstile", pattern: /challenges\.cloudflare\.com\/turnstile|\bcf-turnstile\b/i, reason: "Cloudflare Turnstile widget on the page" },
  { provider: "cloudflare", pattern: /_cf_chl_|\bcf-browser-verification\b|\/cdn-cgi\/challenge-platform\//i, reason: "Cloudflare challenge interstitial" },
  { provider: "generic", pattern: /\bpx-captcha\b|\b_Incapsula_Resource\b|\bdatadome\b/i, reason: "bot-protection interstitial" },
];

// Phrases that mean a challenge when they are the page's own message. On their
// own they prove nothing; they are only trusted in a title, or in a body short
// enough that the phrase IS the page.
const PHRASES: Array<{ provider: ChallengeProvider; pattern: RegExp; reason: string }> = [
  { provider: "cloudflare", pattern: /\bjust a moment\b/i, reason: "Cloudflare interstitial title" },
  { provider: "cloudflare", pattern: /checking (?:your|if the site connection is) (?:browser|secure)/i, reason: "browser check interstitial" },
  { provider: "generic", pattern: /verify (?:you are|that you are|you're) (?:a )?human/i, reason: "human verification prompt" },
  { provider: "generic", pattern: /are you a (?:robot|human)\b/i, reason: "human verification prompt" },
  { provider: "generic", pattern: /\bsecurity (?:check|verification)\b/i, reason: "security verification prompt" },
  { provider: "generic", pattern: /unusual traffic from your computer network/i, reason: "unusual-traffic block" },
  { provider: "generic", pattern: /(?:enable javascript and cookies|please enable cookies) to continue/i, reason: "JavaScript/cookie gate" },
  { provider: "generic", pattern: /\bcomplete the (?:captcha|security check)\b/i, reason: "explicit challenge instruction" },
];

// An interstitial is a stub: a heading, a spinner and a widget. Anything longer
// than this has an article in it, and an article that mentions verification is
// not a challenge.
const SHORT_BODY_CHARS = 1200;

function siteOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function detectChallenge(input: ChallengeInput): ChallengeDetection | null {
  const haystack = `${input.html ?? ""}\n${input.title ?? ""}`;
  for (const marker of MARKERS) {
    if (marker.pattern.test(haystack)) {
      return {
        verificationRequired: true,
        provider: marker.provider,
        site: siteOf(input.url),
        url: input.url,
        reason: marker.reason,
      };
    }
  }

  const title = input.title ?? "";
  const text = (input.text ?? "").trim();
  // A 403/503 raises suspicion but never decides on its own: plenty of pages are
  // simply forbidden, and calling every 403 a CAPTCHA would teach the model to
  // ask for verification it cannot get.
  const suspiciousStatus = input.status === 403 || input.status === 503 || input.status === 429;
  const shortBody = text.length > 0 && text.length <= SHORT_BODY_CHARS;

  for (const phrase of PHRASES) {
    const inTitle = phrase.pattern.test(title);
    const inShortBody = shortBody && phrase.pattern.test(text);
    if (!inTitle && !inShortBody) continue;
    if (!inTitle && !suspiciousStatus && !shortBody) continue;
    return {
      verificationRequired: true,
      provider: phrase.provider,
      site: siteOf(input.url),
      url: input.url,
      reason: phrase.reason,
    };
  }
  return null;
}

// ------------------------------------------------------------------ COOLDOWN
// Once a site has said "human", hammering it is both rude and pointless. This
// records the refusal per host so the next automated attempt within the window
// is declined locally rather than by the site. It is cleared the moment a real
// page comes back from that host, which is what lets the model resume by itself
// after the owner has verified rather than being told to verify forever.

const COOLDOWN_MS = 5 * 60_000;

type ChallengeRecord = { detection: ChallengeDetection; at: number };

const challenged = new Map<string, ChallengeRecord>();

export function rememberChallenge(detection: ChallengeDetection, now = Date.now()): void {
  challenged.set(detection.site, { detection, at: now });
}

export function pendingChallenge(url: string, now = Date.now()): ChallengeDetection | null {
  const site = siteOf(url);
  const record = challenged.get(site);
  if (!record) return null;
  if (now - record.at > COOLDOWN_MS) {
    challenged.delete(site);
    return null;
  }
  return record.detection;
}

export function clearChallenge(url: string): void {
  challenged.delete(siteOf(url));
}

export function challengeNotice(detection: ChallengeDetection): string {
  return [
    `Human verification required at ${detection.site} (${detection.reason}).`,
    "Automated retries are stopped for this site.",
    "Open the Browser panel in Local Studio, complete the verification there, then read the page again — the browser session and its cookies are preserved.",
  ].join(" ");
}
