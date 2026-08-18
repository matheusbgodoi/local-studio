# Status and Usage

Both pages read the **same controller that serves Chat**. There is one rig and one
controller identity; selecting a different controller moves Chat, the model
catalogue, Status and Usage together.

There is no demo data on either page.

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

Token counts are the inference backend's own `usage` object. Nothing is estimated
from message length, and nothing is fabricated:

- totals, per-model breakdown, daily series, hourly pattern and the heatmap come
  from recorded requests
- latency and TTFT are measured wall clock
- `unique_sessions` and `unique_users` are 0 because this stack has no session or
  user identity to count. That is a true zero, not a missing number.

### History starts when collection started

Accounting began the moment the host telemetry was switched on. Earlier traffic
was never recorded and is **not** reconstructed - the backend keeps no
per-request token log, so any history would be invented. `/usage` reports
`collection_started_at` and the page states it:

> Local inference accounting since 18 Aug 2026. Earlier requests were never
> recorded, so they are absent rather than estimated.

### Privacy

Only request metadata leaves the inference path: timestamp, model alias,
endpoint, token counts, duration, TTFT, status. No prompt, completion, reasoning,
tool argument, image or header is recorded anywhere. Asserted by
`local-ai-3090-stack/scripts/tests/test-telemetry.py`.

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
