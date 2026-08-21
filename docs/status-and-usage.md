# Status and Usage

Both pages read the **same controller that serves Chat**. There is one rig and one
controller identity; selecting a different controller moves Chat, the model
catalogue, Status and Usage together.

There is no demo data on either page, and no metric is estimated. A number the
rig did not measure is shown as unavailable, never as 0.

The screenshots below are the installed build against the live rig, captured from
the app's own embedded server. Nothing was staged, warmed or re-run to improve a
number — the energy history is short because that is when the sampler started.

## How the request reaches the rig

```
Usage page ─► api.getUsageStats() ─► /api/proxy/usage ─► backendUrl from
             api-settings.json ─► gateway-edge on ai-node-3090 (tailnet)
```

Status is the same route, calling `/status`, `/gpus` and `/v1/metrics/vllm`.

Previously those four paths 404'd, because this host runs llama-swap rather than
the controller the frontend calls, and the UI rendered that as "offline", "No
model loaded" and "Request failed". The host now serves them; see
`local-ai-3090-stack/docs/32-dashboard-telemetry.md` for the backend side.

## Status

![Status reading the live rig](assets/screenshots/status.png)

Everything shown is read live:

- **model** — the alias llama-swap actually has resident, its state, and its
  context length parsed from the running process's own argv. Load a different
  model and Status follows. No alias, context value or GPU name is hardcoded in
  the client.
- **GPU** — name, VRAM total/used/free, utilisation, temperature, power draw and
  limit, from `nvidia-smi` on the host.

A metric the hardware does not report arrives with its `*_available` flag false
and is shown as unavailable. **A missing sensor is never rendered as 0**, which
is what made the old empty dashboard so misleading.

## Usage

Three tabs — **Tokens**, **Energy**, **Efficiency** — over two shared filters:

```
[ Tokens ][ Energy ][ Efficiency ]      Today 7D 30D 365D All    All models ▼
```

The filters are query parameters on `/usage`, not a client-side slice. The rig
aggregates and returns a compact answer, which is what makes 365D and All
affordable at all — the alternative was shipping a year of request rows to a
laptop to sum them there. **Today** and **All models** are the defaults, so the
page opens on the whole machine's workload for the current local day.

### Tokens

![Usage — processed tokens](assets/screenshots/usage-tokens.png)

The page used to lead with 45.31M "Proxied tokens" and label the prompt total
"Fresh input". Neither number was fabricated and together they misled: on a long
agentic session the conversation is resent every turn, so almost all of that
total was context reused from the KV cache and **never recomputed**. Measured on
this rig, 44.40M of 45.81M prompt tokens were cache reuse.

| shown                | means                                                         |
| -------------------- | ------------------------------------------------------------- |
| **Processed tokens** | fresh prompt evaluation + generated. The primary number.      |
| Fresh input          | prompt tokens the engine actually evaluated                   |
| Generated            | tokens produced                                               |
| Cached input         | prompt tokens reused from the KV cache                        |
| Logical tokens       | logical prompt + generated — total context traffic, secondary |
| Cache hit            | cached input over logical prompt                              |

**Observed performance** — renamed from "Performance" on 2026-08-20 — is the
engine's own measurement (llama.cpp `timings`), not request duration: HTTP wall
time contains queueing, the network and the gateway, and calling that "decode
speed" would understate the engine. Where the backend reported no timing the row
reads `—`, never `0`. The card now says where the numbers come from, because the
old title let a workload measurement read as a synthetic GPU benchmark.

**Speculative decoding** sits beside it. `draft_n` and `draft_n_accepted` come
from the same `timings` block, and llama.cpp attaches them only when a drafter
actually ran. Acceptance is `SUM(accepted) / SUM(drafted)` over the selection,
never the mean of per-request percentages — a request that drafted 2 and kept 2,
next to one that drafted 200 and kept 100, is 50.5%, not 75%.

Two counts are shown rather than one, because a percentage over the wrong
denominator is the same lie in a different place: **MTP requests** counts the
requests that actually drafted, not every request in the period. When nothing was
measured the card says so **in words**. It never renders `0%`, which would claim
speculation ran and accepted nothing — a real and much worse state than "this
model has no drafter". `ornith-turbo` runs without speculation and reads that way.

**Decode by context** is the table underneath, and it exists to stop one aggregate
Decode figure being read as a benchmark. Every timed request is bucketed by the
same context definition the Context card uses — `<16K`, `16–64K`, `64–128K`,
`128–192K`, `192K+` — and each bucket is weighted by tokens over the engine's own
clock. On this rig it immediately shows what the average hides: **56.2 tok/s** at
16–64K, **43.6** at 64–128K, **39.1** at 128–192K, against a single overall figure
of 46.7. Only buckets with data appear; an empty bucket is one nothing was measured
in, and inventing a row for it would suggest otherwise.

Context shows average, P95 and peak against the resident server's own configured
window, so "do I actually use the 146K context" is answerable: on this rig the
peak is 142.6K of 149.5K — **95.4%**.

### Energy

![Usage — GPU energy](assets/screenshots/usage-energy.png)

**GPU board energy only.** Not the CPU, RAM, fans, power-supply losses or the
wall — the page says so under the number. It comes from a sampler on the host
that reads NVML every 5 s and integrates the observed power curve; see
`local-ai-3090-stack/docs/32-dashboard-telemetry.md`.

Coverage is shown because absence of measurement is not zero watts. A day the
sampler did not fully cover reads `partial` with its percentage; a day it never
covered has no square at all, rather than a zero-valued green one.

### Currency and electricity rate

A small control on the Energy tab, persisted per user in
`localStorage["local-studio.usage.energy"]` as `{ currency, pricePerKwh,
timezone }`. Defaults: **BRL**, **America/Sao_Paulo**, and **no rate**.

There is deliberately no default tariff. Until one is entered, every cost reads
"Set rate" — an invented number would quietly become somebody's electricity bill.

- Cost is `energy_kWh × your rate`, computed at render time. **No cost is ever
  stored**, which is why correcting the rate re-prices Today, 7D, 30D, 365D and
  All at once without touching a recorded row.
- Changing the currency does **not** convert anything. Currency and rate are one
  pair you configure together; no exchange-rate service is contacted.
- Formatting is `Intl.NumberFormat`, and the currency list is
  `Intl.supportedValuesOf("currency")` with BRL, USD, EUR and GBP first.
- Historical estimates use your _currently configured_ rate. Tariff history is
  not modelled.

### Efficiency

![Usage — efficiency](assets/screenshots/usage-efficiency.png)

The hero is **what one million tokens cost, per side** — input on the left,
output on the right, in your currency, with the `output / input` ratio between
them. The two are one order of magnitude apart and are deliberately set at the
same type size: size encodes hierarchy here, not magnitude, and shrinking the
input side would tell you it does not matter. The gap is carried by the ratio,
by the Wh sub-line, and by two bars on one shared scale.

With no electricity rate set, the same layout renders the same two figures in
**Wh** instead of money. Nothing moves and no slot says "set a rate" — the
no-tariff state is a unit swap, and the rate control appears directly under the
hero.

**Measured, your traffic, and modelled are three different things**, and the tab
labels every card with which one it is:

- **Measured** — the per-side rates come from a bench run on this rig and are
  read from a config file with their provenance attached. The hero footnote says
  when they were measured and what they exclude, and it reads those exclusions
  off the payload rather than asserting them: `scope: "marginal"` is what means
  idle draw is outside the rate and `energy_source: "gpu_board_power"` is what
  means the rest of the host is. A config that says neither gets neither claim.
- **Your traffic** — this period's telemetry, which moves with the period
  selector. `kwh_per_million_processed` is the **combined** figure: all measured
  board energy over all processed tokens, idle included. It is a different
  measurement from the two bench rates, not a merge of them, and it is never
  divided to fake a per-side number.
- **Modelled** — your own token counts priced at the measured rate. Arithmetic
  on the two, not a third measurement. Under **All models** the token totals span
  every alias on the rig, so only the traffic that ran on the measured model is
  priced; any other alias that ran is named beside the figures and left unpriced.
  When nothing attributable is left, the modelled tiles and card do not render at
  all.

The split cannot be derived from telemetry and the controller does not try: the
energy samples carry no request id and have a 60-second grain, while most
requests are shorter than a minute. The store knows what N tokens cost in total;
it cannot know how that total divided between reading a prompt and writing an
answer. That is the whole reason the per-side rates are bench-measured and read
from a config, and it is why a UI that renders them next to telemetry has to keep
saying which is which.

An **unmeasured** physical model is named, never zeroed and never given another
model's rate — "nobody measured this" and "this costs nothing" are different
statements. The by-model table leaves its input and output columns blank for the
same reason.

The `How <model> was measured` disclosure carries the long form: the method, the
sample, the exclusions, and the config's own notes. Those notes arrive as wrapped
lines and are joined back into prose before rendering, verbatim — the client does
not rewrite text it was handed.

Efficiency itself is computed only when both halves exist; otherwise the page
says which one is missing instead of showing a ratio. When energy coverage for
the period is thin, the strip, this-period card and cache card all say so, and so
does the combined hero — its numerator is the sampled seconds while its
denominator is the whole period's tokens, so it reads low. The bench hero does
not, because coverage has no bearing on a bench measurement. Board energy and
period cost under partial coverage are floors, never the period's bill, which is
also why a marginal request cost can exceed them.

Selecting one model recalculates from that model's processed tokens and the
energy measured while it was resident — and picks that model's bench rate for the
hero. Selecting a model no bench run measured shows **no** per-side price: it is
named as unmeasured rather than handed the other model's rate. With more than one
measured model and no selection, no price is shown either — two measured models
do not average into a third.

### Days, and where midnight is

A day is a **local** day in the configured timezone, defaulting to
`America/Sao_Paulo`. Instants are stored in UTC on the host; only the bucket is
local. `7D` means today plus the previous six local days, not the last 168 hours.

### The daily squares

Each tab's heatmap is scaled by that tab's own metric — processed tokens, kWh,
tokens per kWh — bucketed by quantile so one enormous day cannot make every other
day invisible. Hovering a square prints its exact values.

The squares always span the year, whatever period is selected; days outside the
selection are dimmed rather than hidden. A day with no data renders as an
outline, visibly different from a day that recorded a real zero.

### History starts when collection started

Two different start dates, both stated on the page:

- **Tokens** began when host telemetry was switched on. Earlier traffic was never
  recorded and is **not** reconstructed — the backend keeps no per-request token
  log, so any history would be invented.
- **Energy** began when the sampler was first started, later than tokens. Earlier
  days are blank. Estimating past consumption from token counts would be exactly
  the fabrication this page exists to avoid.

Fields the migration could derive exactly from values already stored — cached
versus fresh prompt split, generated tokens, context occupancy — were backfilled.
Per-request timings, which no stored value determines, stayed missing.

### Privacy

Only request metadata leaves the inference path: timestamp, model alias,
endpoint, token counts, engine timings, context counts, duration, TTFT, status.
The energy tables add only watts, temperature, utilisation, a date and a model
alias. No prompt, completion, reasoning, tool argument, image or header is
recorded anywhere. Asserted by
`local-ai-3090-stack/scripts/tests/test-telemetry.py` and
`scripts/tests/test-usage-v2.py`.

There is no Sessions tile any more. It was always 0 — this stack has no session
identity — and a permanent zero in a stat strip reads as "you used nothing".

## When it cannot load

The controller is legitimately offline much of the time, so Usage names the
condition instead of printing the transport error:

| condition              | what the page says                          |
| ---------------------- | ------------------------------------------- |
| controller unreachable | **Controller offline** — not zeroed numbers |
| 401 / 403              | **The controller rejected this key**        |
| 404                    | **This controller does not report usage**   |
| anything else          | the underlying message, verbatim            |

A missing optional metric never blanks the page; only that metric is affected.

## Related

[`web-search.md`](web-search.md) covers `browser_search`, the reader-first
research path and the human-verification workflow.

## Update policy

This build is customised and does not accept upstream artefacts. See
[`upstream-updates.md`](upstream-updates.md).
