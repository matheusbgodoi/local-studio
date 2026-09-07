---
name: browser
description: Search the web and drive the Local Studio embedded browser when the user opens/enables the Browser panel or asks to browse, open, inspect, search, research, or interact with web pages.
---

# Browser

The Browser is the live embedded browser panel in Local Studio. When this skill is loaded, the browser tools are available and connected to the currently focused session.

Use these tools when the user asks you to search, research, browse, open a page, inspect a link, interact with a website, or when current web content matters.

## Tools

- `browser_search` searches the public web and returns ranked results (title, url, domain, snippet). Discovery only — it does not open the pages.
- `browser_navigate` opens an absolute `http(s)` URL in the embedded browser.
- `browser_get_url` returns the current browser URL.
- `browser_get_text` returns the visible page text.
- `browser_get_html` returns rendered HTML when text is not enough.
- `browser_screenshot` captures the current page.
- `browser_click` clicks a CSS selector.
- `browser_scroll` scrolls the page.
- `browser_fill` fills a form field by CSS selector.
- `browser_verify` opens a visible browser window so the user can complete a CAPTCHA, security check or sign-in by hand.

## Research protocol

For a normal "what is the current X" question:

1. `browser_search` once, with a precise query.
2. Choose the strongest source — usually the primary one.
3. Open it and read it.
4. Answer only from what you actually read.

For real research:

1. Two to four focused queries, only if one is genuinely not enough.
2. Prefer primary sources: official documentation, the original repository, the paper itself, then reputable secondary coverage. Forums and Reddit are legitimate primary evidence when the question is about lived experience rather than specification.
3. Open the strongest two to four sources and read them.
4. Cross-check any claim you are going to state as fact.

**A snippet is not a source.** Never present something as read when you only saw it in search results; either open the page or say the claim comes from a search snippet.

Useful query shapes: exact quotes for a phrase, exact model or version names, `site:example.com` to pin a domain, a year or version when freshness matters, `filetype:pdf` for papers and specs.

## Reading a page

Prefer `browser_navigate` then `browser_get_text` — it is fast and small. Reach for `browser_get_html`, `browser_screenshot`, `browser_click` or `browser_scroll` only when the text alone does not answer the question, e.g. a site that renders nothing without interaction.

## When a site asks for a human

A tool result containing `verificationRequired: true` means the site is showing a CAPTCHA, a Cloudflare interstitial or a similar check. There is no automatic bypass and you must not attempt one.

1. Do not retry, reload, or try a different address for that site.
2. Tell the user plainly which site needs verification and why.
3. Call `browser_verify` to open a visible window on the same session, and ask the user to complete the check there.
4. When they say they are done, call `browser_get_text` again. If the page comes back, continue; the session and its cookies are preserved.

The same path works for a site that needs a login: navigate to the login page, call `browser_verify`, and let the user sign in themselves. Never type credentials, payment details, or any other secret into a page yourself.

## Honesty

1. If a browser tool reports a failure, say so; do not claim you opened or inspected the page.
2. If search returns nothing, say search returned nothing rather than answering from memory as if you had looked.
