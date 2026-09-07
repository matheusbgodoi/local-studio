# Web search and browsing

Local Studio can search the public web and read what it finds. There is **no API
key, no account, no container and no extra daemon** — search is an HTTP request
through the same guarded transport the reader already used.

Search is not offline. See [Privacy](#privacy).

## The tool

`browser_search(query, maxResults?)` — "Browser: Web Search". One tool, not a
family: the model never picks a provider, and there is no `google_search` or
`fast_search` beside it.

It returns **discovery results only**:

```json
{ "rank": 1, "title": "…", "url": "https://…", "domain": "example.com", "snippet": "…" }
```

Eight by default, fifteen at most. It does **not** fetch the pages — eight page
bodies would fill the context window to answer a question that usually needs one.

### It only exists when the Browser is on

`browser_search` lives in the Browser Pi extension, so it inherits the same
gate as the rest of the browser tools: with the Browser toggle off the extension
is never loaded and none of its schemas reach the model. There is no global
web-search injection.

## Providers

| order | endpoint | when |
|---|---|---|
| primary | `html.duckduckgo.com/html/` | always tried first |
| fallback | `lite.duckduckgo.com/lite/` | once, if the primary fails or parses to nothing |

Both are DuckDuckGo's own **no-JavaScript HTML frontends**, intended for browsers
that cannot run scripts. They are **pages, not a supported API**: the markup can
change without notice and the parser is best-effort by construction. When it
stops matching, search reports no results and says why — it never invents one.

There is no third attempt. A provider that is rate-limiting or challenging does
not want another request, and cycling endpoints to get around that is precisely
the behaviour this feature is not allowed to have. A 429 or a challenge puts that
frontend in a five-minute cooldown, enforced locally.

Results are deduplicated on the canonical target (trailing slash, `utm_*`, `www.`
and fragments do not make two results), ads and provider navigation links are
dropped, and the engine's ranking is otherwise preserved. **No AI reranker.**

### Cache

Identical queries within ten minutes are answered from a small in-memory cache
(64 entries, keyed by the normalised query and result count). Nothing is written
to disk; there is no search-history database. An empty result set is deliberately
**not** cached, so a transient provider hiccup cannot answer "nothing found" for
the next ten minutes.

## Reading what you found

Reader first:

```
browser_search  →  pick 1–3 results  →  browser_navigate + browser_get_text
                                         ↑ static reader: fast, small, safe
                   if the page needs JavaScript → the rendered browser
                   if the page shows a challenge → human verification
```

The static reader is the same `fetchReadable()` the fetch route uses, with the
same guards: public http(s) only, DNS resolved and re-checked against private
ranges, bounded redirects, a body cap and a timeout. Search requests go through
that identical transport rather than a second implementation, so the SSRF, size
and timeout rules cannot drift apart.

## Human verification

Some sites ask for a human. Local Studio **detects** that and **hands the page
over**. It does not solve it.

> **Human verification is supported; automated CAPTCHA bypass is not
> implemented.**

There is no CAPTCHA-solving service, no OCR, no audio solver, no fingerprint
spoofing, no proxy rotation and no challenge-token replay. None of that is a
gap to be filled later — it is the design.

### What is detected

reCAPTCHA, hCaptcha, Cloudflare Turnstile, Cloudflare interstitials and similar
bot-protection pages, from widget markup, the page title, and short-page phrases
like "verify you are human" or "checking your browser".

Detection is deliberately conservative, because a false positive is worse than a
false negative here: it sends the owner to solve a CAPTCHA that does not exist.
A news article about CAPTCHAs is not a challenge, and a bare `403` is not assumed
to be one — a widget must be present, or the phrase must be the whole short page.

### What happens next

1. The tool result carries `verificationRequired: true` with the site and reason.
2. **Automated retries against that site stop** for five minutes. No refresh
   loop, no user-agent shuffling, no alternate address.
3. The chat row says *Human verification required* and offers **Open Browser**.
4. `browser_verify` reopens the **same browser profile in a visible window** so
   the owner can complete the check — or a genuine sign-in — by hand.
5. Afterwards, reading the page again just works. Every read is also a re-check,
   so once the challenge clears the model continues instead of asking again.

The same path covers a legitimate login. The model may navigate to the login
page; the owner types the credentials. Passwords are never stored, never logged
and never sent to the model.

## The browser profile

Local Studio uses a **dedicated** browser profile at
`<userData>/browser-profile` (override with `LOCAL_STUDIO_BROWSER_PROFILE_DIR`).
It is where cookies live after a verification or a sign-in, which is what lets a
site remember you between requests.

It is durable on purpose. It used to live in `os.tmpdir()`, which the OS is
entitled to sweep and every process on the machine can read — fine for a scratch
page, wrong for a directory that now holds session cookies.

Your own Chrome profile is never opened, copied or hijacked. The separate
Sitegeist backend remains the explicit, non-default way to drive your own
browser.

**Concurrency.** Chromium cannot switch a live context between headless and
visible, and two processes must never share one profile directory, so switching
modes closes the context and reopens the same profile. Cookies survive because
they are on disk. If the profile is genuinely already in use, the browser starts
an isolated copy and logs a warning — that copy does **not** carry verified
sessions.

## Privacy

- **Search queries leave the machine.** They go to DuckDuckGo. Opening a result
  contacts that website. Local model prompts and completions remain local.
- Queries are **not** written to the host telemetry database, and there is no
  separate search-history store. A query exists only in the conversation you
  typed it into and in the ten-minute in-memory cache.
- Credentials are never stored, logged or sent to the model. Session cookies stay
  in Local Studio's own profile directory and are never copied anywhere.

## Verifying a change

Deterministic fixtures, no live provider:

```bash
cd services/agent-runtime
bun test test/browser-search-parsing.test.ts       # both frontends, redirects, dedupe, ads,
                                                   # empty + malformed pages, cache, cooldown
bun test test/browser-challenge-detection.test.ts  # each challenge family, and the false
                                                   # positives that matter (an article about
                                                   # CAPTCHAs, a bare 403)
bun test test/browser-session-persistence.test.ts  # cookies + local storage survive the switch
                                                   # to the visible window, on a local page
```

Plus `npm run check` at the repo root, and one harmless live query if you want to
confirm the provider still parses.
