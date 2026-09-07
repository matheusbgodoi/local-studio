# Status and HTTP readiness — 2026-09-07

## MEASURED / PROVEN

The installed Effect dependency executes `Effect.all` sequentially unless concurrency is explicit. A one-shot, in-memory observation of four independent 100 ms effects completed at 105, 207, 309, and 410 ms. The previous status poll used that default and waited for status, compatibility, GPU inventory, and metrics before publishing anything. Metrics also inherited the general 30-second request timeout and three retries.

Frontend TypeScript and scoped ESLint passed at this initial source milestone. The later integrated checks and bounded installed offline/recovery observations are recorded below; compilation alone is not product acceptance.

## DECIDED / APPLIED — source only

- The four independent status probes run concurrently, each with a five-second timeout and no retries.
- Existing status remains visible during refresh. A failed status poll marks connectivity unavailable immediately while retaining cached values with their original observation timestamps.
- Only a newer status SSE event invalidates an older status poll. GPU and metrics events cannot discard its completion and strand the loading indicator. Controller identity and request sequence checks still reject stale work.
- Controller HTTP requests retain their deadline through complete non-streaming response-body consumption, including error bodies and typed RPC responses. SSE retains its connection deadline without acquiring a lifetime limit.
- Caller cancellation reaches fetch, releases a half-open probe, and does not mark the controller unreachable.
- Completed HTTP error responses are handled separately from transport failures. A real 4xx or 5xx response proves reachability; only the proxy's explicit upstream-timeout marker establishes unreachability. Transport failures and expired request deadlines also close the breaker, including half-open probes.
- The unused breaker-reset export was removed rather than retained as a dead-code exception.

## HYPOTHESIS / TODO — acceptance

Use the installed candidate to open Status, historical chats, Settings, Memory, and Tasks with the inference controller unavailable. Verify that local surfaces load, Status reaches an explicit unavailable state, cached measurements retain their age, and reconnection recovers automatically. Exercise headers followed by a stalled JSON body, ordinary HTTP errors followed by a healthy request, and long-running SSE separately. No installed app or remote service was changed in this source milestone.

## Installed browser profiling

The existing `perf:browser` entrypoint now accepts `LOCAL_STUDIO_PERF_TOKEN_FILE` and reads the credential internally. It seeds an HttpOnly cookie in a fresh temporary browser profile, restricted to a loopback target. It never installs global authentication headers or prints credentials. `LOCAL_STUDIO_PERF_ROUTES` selects a comma-separated subset of existing pages. The diagnostic checks the main document HTTP status and application scripts, counts JavaScript exceptions and console errors, and reports sanitized source locations and local HTTP failure routes. Temporary browser profiles are removed after each route.

MEASURED: the old diagnostic passed the installed authentication-denial pages (12 DOM nodes, 98 text characters, zero scripts). The updated diagnostic rejects the same unauthenticated Settings request with HTTP 401 and missing application scripts.

MEASURED: authenticated profiling of the installed September 1 bundle on September 7 returned HTTP 200 and real scripts for seven major pages. First contentful paint was 52–208 ms, measured task time 101–173 ms, and heap 7.3–13.2 MiB. Agent, Usage, Configure, Automations, and Runs showed no uncaught exceptions or console errors in the 1.5-second observation window. Settings emitted two uncaught JavaScript exceptions; Status emitted one console error. The diagnostic correctly failed. These are short cold-page observations, not long-session memory or interactive workflow acceptance, and are not acceptance of a newly built candidate.

Run against the installed frontend port (not the agent-runtime port), for example:

```sh
LOCAL_STUDIO_PERF_URL=http://127.0.0.1:61169 \
LOCAL_STUDIO_PERF_TOKEN_FILE="$HOME/Library/Application Support/Local Studio/frontend-token" \
LOCAL_STUDIO_PERF_ROUTES=/,/agent,/settings,/configure,/usage,/runs,/agent/automations \
npm --prefix frontend run perf:browser
```

## Settings setup isolation

MEASURED / PROVEN: authenticated installed Settings emitted one to two uncaught rejected requests on repeated profiling. Their stack points to the controller HTTP error constructor, while the resource failures include `/studio` requests. Source tracing found Settings mounted `useSetup` unconditionally. That hook eagerly created both setup request promises before the sequential Effect collector attached the second rejection handler. An unsupported setup API could therefore reject outside its intended error boundary. It also polled downloads on a page that was not displaying setup.

DECIDED / APPLIED — source only: Settings now renders Settings regardless of inference connectivity or browser-local first-run state. Setup remains available at `/setup`, and the existing dashboard first-run redirect is unchanged. Setup requests are lazy Effect callbacks and independent setup reads run concurrently, so each rejection is owned from its creation. Actual HTTP errors retain their cause instead of being mislabeled as timeouts. The later installed candidate acceptance below no longer reproduced the Settings exceptions.

## Installed candidate acceptance and diagnostic routing

MEASURED / PROVEN — September 7, candidate `bbb78a9c`, installed as CRIAs AI Dev with isolated acceptance data: Settings, memory, Models and Integrations load real application documents with zero uncaught exceptions. Settings no longer reproduces the old installed bundle's initialization exceptions. Their cold FCP was 56–124 ms in the short browser observations. Local projects, session history, memory, automations and run APIs returned HTTP 200.

MEASURED / PROVEN — with only the isolated application's backend pointed at a loopback server that accepts requests but withholds responses for 30 seconds, all eleven profiled routes/variants returned real application documents, without uncaught JavaScript exceptions. FCP was 68–100 ms; local settings, projects, history, memory, automations and runs responded in 8–21 ms. Agent model discovery returned a bounded HTTP 502 after 8.033 seconds. Remote proxy resources returned HTTP 504; the dashboard logged one timeout console error. These expected transport failures still fail the diagnostic, rather than producing a false green. Page rendering and local reads are proven; successful inference, interactive controls and indefinite long-session behavior are not implied.

DECIDED / APPLIED — the existing profiler accepts query/hash variants of known routes and follows same-origin redirects, including `/integrations` to `/configure?section=integrations#integrations`. It blocks cross-origin document navigation. Each route's failure is retained without discarding later routes. Chrome termination is awaited before profile deletion, fixing an observed `ENOTEMPTY` cleanup race. `LOCAL_STUDIO_PERF_OBSERVE_MS` allows up to ten seconds of post-load observation; the `busy` column counts explicit ARIA busy/progress indicators and does not claim detection of every custom spinner. No automated tests were introduced.

TARGET / NOT APPLIED — online capability probing still produces HTTP 404 responses on several optional gateway routes, and offline remote reads produce HTTP 504. Eliminating unnecessary capability fan-out and improving deliberate unavailable-state messaging remain separate product work.

MEASURED / PROVEN — a nine-second observation of Status, Agent, memory and Models found zero uncaught exceptions and zero ARIA busy/progress markers. A subsequent nine-second fixed-whitelist label observation reported `Offline` on Status and Models, and `No models` plus `Retry` on Agent. These labels show a deliberate unavailable state; clicking Retry was outside this read-only pass. Label output contains only predefined diagnostic terms, never page text or private transcript content. The dashboard retained one or two timeout console entries across observations.

## Declared non-chat artifacts in the agent catalog

MEASURED / PROVEN — the installed oMLX `/v1/models` returns Chatterbox speech and S3Tokenizer artifacts without modality fields. Its detailed `/v1/models/status` declares Chatterbox `model_type=audio_tts`; S3Tokenizer has `config_model_type=s3_tokenizer_v2` despite an incorrect generic `model_type=llm`. Both report `is_helper=false`, so the already enabled helper-hiding setting cannot solve this. Source previously accepted every model-list row into the agent catalog.

DECIDED / APPLIED — agent catalog discovery enriches only rows explicitly owned by `omlx` with its detailed status, validates both boundaries with Effect Schema, and excludes declared non-chat modalities and the explicit S3 tokenizer configuration. Other providers make no additional request. The enrichment has a two-second request/body deadline; malformed, missing or unavailable metadata preserves the original catalog. Unknown model types remain eligible. Speech artifacts and speech APIs are unchanged. This is a catalog filter, not a generic chat-capability guarantee.

MEASURED / PROVEN — the source helper against the actual Mac oMLX list/status reduced three rows to one in 4 ms: Ornith retained, Chatterbox and S3Tokenizer excluded. This read-only command sent no model turn and wrote no application state. Runtime build-configuration TypeScript passed. The later final2 installed model API returned five models, retaining Mac Ornith and four RTX aliases while excluding Chatterbox and S3Tokenizer; see [the installed receipt](installed-candidate-2026-09-07.md).

MEASURED / PROVEN — after restoring the acceptance application's original settings, fresh browser navigation to memory and Models returned real documents with zero exceptions, console errors or ARIA busy markers at nine seconds; the Models `Offline` label disappeared. This is recovery by fresh navigation, not a claim of same-tab recovery or successful inference.
