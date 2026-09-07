# Status and HTTP readiness — 2026-09-07

## MEASURED / PROVEN

The installed Effect dependency executes `Effect.all` sequentially unless concurrency is explicit. A one-shot, in-memory observation of four independent 100 ms effects completed at 105, 207, 309, and 410 ms. The previous status poll used that default and waited for status, compatibility, GPU inventory, and metrics before publishing anything. Metrics also inherited the general 30-second request timeout and three retries.

Frontend TypeScript and scoped ESLint pass for this change. Installed-product offline/recovery acceptance and the integrated `npm run check` remain pending; compilation is not product acceptance.

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
