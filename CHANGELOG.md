# Changelog — owner fork

Owner builds of this fork. Upstream's own history is in
[`sybil-solutions/local-studio`](https://github.com/sybil-solutions/local-studio/releases)
and is not repeated here.

Versioning is `<upstream base>-local.<n>` — see
[`docs/upstream-updates.md`](docs/upstream-updates.md).

## v2.1.0-local.1 — 2026-08-19

First tagged owner build. Base: upstream **2.1.0** (`eeeb3406`). Source only; no
binary is published. See the
[release](https://github.com/matheusbgodoi/local-studio/releases/tag/v2.1.0-local.1).

### Usage: tokens, energy, efficiency

- Usage rebuilt around three tabs — **Tokens**, **Energy**, **Efficiency** — over
  a shared Today / 7D / 30D / 365D / All period and an all-models-or-one filter,
  aggregated on the rig rather than in the browser.
- **Processed tokens** replaced the old headline. Cached prompt reuse is no longer
  counted as work: on the reference rig, 44.40M of 46.14M logical tokens were
  cache reuse and 1.73M were actually processed.
- Throughput reads llama.cpp's own `timings`, never HTTP duration; context
  pressure is measured against the resident server's own window.
- **GPU board energy** with coverage accounting — an unmeasured hour is unknown,
  never zero — and efficiency in processed tokens per kWh.
- Currency, electricity rate and calendar timezone as user preferences. **No cost
  is ever stored**, so correcting the rate re-prices all of history at once.
- The `Sessions` tile was removed: it was always 0 and read as "you used nothing".

### Web search and browsing

- **`browser_search`** — keyless discovery via DuckDuckGo's HTML frontend with a
  single Lite fallback. No API key, account, container or daemon. It lives in the
  Browser extension, so the Browser toggle gates it like every other browser tool.
- Reader-first page reading through the existing SSRF-guarded transport, with the
  rendered browser as fallback.
- **Human verification**: challenges are detected, retries stop, and the page is
  handed to the owner in a visible window on the same browser profile.
  **Automated CAPTCHA bypass is deliberately not implemented.**
- The browser profile moved out of `os.tmpdir()` into `<userData>/browser-profile`,
  because it now holds cookies from sites the owner verified or signed in to.

### Documentation and licensing

- `NOTICE` added: the Apache-2.0 §4(b) record of what this fork modified.
- The README's Download section no longer hands readers the upstream DMG without
  saying what installing it costs.
- `AGENTS.md` reconciled with the tree it describes.
