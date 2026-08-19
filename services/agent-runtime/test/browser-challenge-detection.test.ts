import { beforeEach, describe, expect, test } from "bun:test";
import {
  challengeNotice,
  clearChallenge,
  detectChallenge,
  pendingChallenge,
  rememberChallenge,
} from "../src/browser-host/challenge";

// The expensive mistake here is not a missed challenge — it is a FALSE one. A
// page wrongly flagged makes the model refuse to read something perfectly
// readable and send the user off to solve a CAPTCHA that does not exist. So the
// article fixtures below matter more than the challenge fixtures: they are the
// ones that keep the detector honest.

const RECAPTCHA_PAGE = `
<html><head><title>Verify</title></head>
<body>
  <script src="https://www.google.com/recaptcha/api.js"></script>
  <div class="g-recaptcha" data-sitekey="abc"></div>
</body></html>`;

const HCAPTCHA_PAGE = `
<html><head><title>Access check</title></head>
<body><div class="h-captcha" data-sitekey="def"></div>
<script src="https://hcaptcha.com/1/api.js"></script></body></html>`;

const CLOUDFLARE_PAGE = `
<html><head><title>Just a moment...</title></head>
<body><div id="cf-wrapper">
<script>window._cf_chl_opt={cvId:"3"};</script>
<h1>Checking your browser before accessing example.com</h1></div></body></html>`;

const TURNSTILE_PAGE = `
<html><head><title>example.com</title></head>
<body><div class="cf-turnstile" data-sitekey="0x4"></div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>`;

// A real article about CAPTCHAs. Every trigger word is present, in prose.
const ARTICLE_ABOUT_CAPTCHAS = `
<html><head><title>How CAPTCHA works, and why it is failing</title></head><body>
<article><p>${"A CAPTCHA asks you to verify you are human, and reCAPTCHA made that a global default. ".repeat(
  30,
)}</p></article></body></html>`;

const ARTICLE_TEXT = "A CAPTCHA asks you to verify you are human. ".repeat(60);

const ORDINARY_PAGE = `
<html><head><title>ggml-org/llama.cpp: LLM inference in C/C++</title></head>
<body><main><h1>llama.cpp</h1><p>Inference of LLMs in pure C/C++.</p></main></body></html>`;

beforeEach(() => {
  clearChallenge("https://example.com/x");
  clearChallenge("https://other.example/y");
});

describe("challenge markers", () => {
  test("recognises a reCAPTCHA widget", () => {
    const detection = detectChallenge({ url: "https://example.com/x", html: RECAPTCHA_PAGE });
    expect(detection?.provider).toBe("recaptcha");
    expect(detection?.site).toBe("example.com");
  });

  test("recognises an hCaptcha widget", () => {
    expect(detectChallenge({ url: "https://example.com/x", html: HCAPTCHA_PAGE })?.provider).toBe(
      "hcaptcha",
    );
  });

  test("recognises a Cloudflare interstitial", () => {
    expect(detectChallenge({ url: "https://example.com/x", html: CLOUDFLARE_PAGE })?.provider).toBe(
      "cloudflare",
    );
  });

  test("recognises Turnstile even with an ordinary title", () => {
    expect(detectChallenge({ url: "https://example.com/x", html: TURNSTILE_PAGE })?.provider).toBe(
      "turnstile",
    );
  });

  test("reports the reason so the user is told what happened", () => {
    expect(detectChallenge({ url: "https://example.com/x", html: RECAPTCHA_PAGE })?.reason).toMatch(
      /reCAPTCHA/i,
    );
  });
});

describe("false positives", () => {
  test("an article about CAPTCHAs is not a challenge", () => {
    expect(
      detectChallenge({
        url: "https://example.com/x",
        status: 200,
        title: "How CAPTCHA works, and why it is failing",
        text: ARTICLE_TEXT,
        html: ARTICLE_ABOUT_CAPTCHAS,
      }),
    ).toBeNull();
  });

  test("an ordinary page is not a challenge", () => {
    expect(
      detectChallenge({ url: "https://github.com/x", status: 200, html: ORDINARY_PAGE }),
    ).toBeNull();
  });

  test("a bare 403 is not assumed to be a CAPTCHA", () => {
    expect(
      detectChallenge({
        url: "https://example.com/x",
        status: 403,
        title: "403 Forbidden",
        text: "You do not have permission to access this resource.",
      }),
    ).toBeNull();
  });

  test("a short page that says it wants a human IS a challenge", () => {
    expect(
      detectChallenge({
        url: "https://example.com/x",
        status: 403,
        title: "example.com",
        text: "Please verify you are human to continue.",
      })?.provider,
    ).toBe("generic");
  });
});

describe("cooldown", () => {
  const detection = {
    verificationRequired: true as const,
    provider: "cloudflare" as const,
    site: "example.com",
    url: "https://example.com/x",
    reason: "Cloudflare challenge interstitial",
  };

  test("a challenged site is remembered so it is not retried", () => {
    rememberChallenge(detection, 1_000);
    expect(pendingChallenge("https://example.com/other", 1_000)).not.toBeNull();
  });

  test("a different site is unaffected", () => {
    rememberChallenge(detection, 1_000);
    expect(pendingChallenge("https://other.example/y", 1_000)).toBeNull();
  });

  test("the memory expires rather than blocking the site forever", () => {
    rememberChallenge(detection, 1_000);
    expect(pendingChallenge("https://example.com/x", 1_000 + 6 * 60_000)).toBeNull();
  });

  test("a page that comes back clears it, so the model can resume by itself", () => {
    rememberChallenge(detection, 1_000);
    clearChallenge("https://example.com/x");
    expect(pendingChallenge("https://example.com/x", 1_000)).toBeNull();
  });

  test("the notice names the site and points at the Browser panel", () => {
    const notice = challengeNotice(detection);
    expect(notice).toContain("example.com");
    expect(notice).toMatch(/Browser panel/i);
    expect(notice).toMatch(/retries are stopped/i);
  });
});
