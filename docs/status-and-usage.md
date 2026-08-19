# Status and Usage

Both pages read the **same controller that serves Chat**. There is one rig and one
controller identity; selecting a different controller moves Chat, the model
catalogue, Status and Usage together.

There is no demo data on either page, and no metric is estimated. A number the
rig did not measure is shown as unavailable, never as 0.

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

The page used to lead with 45.31M "Proxied tokens" and label the prompt total
"Fresh input". Neither number was fabricated and together they misled: on a long
agentic session the conversation is resent every turn, so almost all of that
total was context reused from the KV cache and **never recomputed**. Measured on
this rig, 44.40M of 45.81M prompt tokens were cache reuse.

| shown | means |
|---|---|
| **Processed tokens** | fresh prompt evaluation + generated. The primary number. |
| Fresh input | prompt tokens the engine actually evaluated |
| Generated | tokens produced |
| Cached input | prompt tokens reused from the KV cache |
| Logical tokens | logical prompt + generated — total context traffic, secondary |
| Cache hit | cached input over logical prompt |

Performance is the engine's own measurement (llama.cpp `timings`), not request
duration: HTTP wall time contains queueing, the network and the gateway, and
calling that "decode speed" would understate the engine. Where the backend
reported no timing the row reads `—`, never `0`.

Context shows average, P95 and peak against the resident server's own configured
window, so "do I actually use the 146K context" is answerable: on this rig the
peak is 142.6K of 149.5K — **95.4%**.

### Energy

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
- Historical estimates use your *currently configured* rate. Tariff history is
  not modelled.

### Efficiency

**Processed tokens / kWh**, with kWh per 1M processed and cost per 1M beside it.
It is computed only when both halves exist; otherwise the page says which one is
missing instead of showing a ratio. When energy coverage for the period is thin
the caption says so rather than presenting a partly measured denominator as
exact.

Selecting one model recalculates from that model's processed tokens and the
energy measured while it was resident — observational comparison without running
a benchmark.

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

| condition | what the page says |
|---|---|
| controller unreachable | **Controller offline** — not zeroed numbers |
| 401 / 403 | **The controller rejected this key** |
| 404 | **This controller does not report usage** |
| anything else | the underlying message, verbatim |

A missing optional metric never blanks the page; only that metric is affected.

## Update policy

This build is customised and does not accept upstream artefacts. See
[`upstream-updates.md`](upstream-updates.md).
