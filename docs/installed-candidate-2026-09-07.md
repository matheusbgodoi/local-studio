# Installed candidate receipt — September 7, 2026

## MEASURED / PROVEN — source and build

Root worktree `/Users/matheusbgodoi/src/local-studio-readiness` was clean at `eb6f875f9c2f81080c2848ff25a8ba2a8df3e267` before and after these successful commands:

- `npm run check`: exit 0; static analysis, frontend production build, controller checks and runtime production build completed.
- `npm --prefix frontend run desktop:dist:dev`: exit 0; native dependency preparation, embedded frontend/runtime assertions and macOS archive/blockmap generation completed.

Logs: `/tmp/local-studio-readiness-check-final2-20260907.log` and `/tmp/local-studio-readiness-build-final2-20260907.log`.

App: `frontend/dist-desktop-dev/mac-arm64/CRIAs AI Dev.app`.

| Artifact | SHA-256 |
| --- | --- |
| `frontend/dist-desktop-dev/CRIAs AI Dev-2.1.0-arm64-mac.zip` | `5a29775cd54924d5465b37d23809525591fe78d50aa7e1b732177d3945e251a6` |
| `frontend/dist-desktop-dev/CRIAs AI Dev-2.1.0-arm64.dmg` | `20c110d5d7e605858e77d0df73eafa678f2f13737413119886e63ea3d1456336` |

## DECIDED / APPLIED — installation scope

The root engineer installed the candidate through the documented installer and relaunched CRIAs AI Dev with isolated acceptance user data. The frontend served on loopback port 50801. Stable application data and production inference configuration were not changed by the browser diagnostic. This receipt covers the development installation, not promotion to the stable application.

## MEASURED / PROVEN — installed read-only acceptance

The existing authenticated `perf:browser` entrypoint observed each targeted route for nine seconds after load. Authentication was read from the isolated frontend token file into a loopback-scoped cookie; no credential or transcript was printed. No inference request was sent.

| Route | Document | FCP | Browser task time | JS heap | Uncaught / console errors | ARIA busy markers |
| --- | --- | --- | --- | --- | --- | --- |
| `/agent` | HTTP 200, app scripts | 64 ms | 166.2 ms | 13.7 MiB | 0 / 0 | 0 |
| `/models` | HTTP 200, app scripts | 80 ms | 125.3 ms | 8.0 MiB | 0 / 0 | 0 |
| `/runs` | HTTP 200, app scripts | 84 ms | 106.9 ms | 7.9 MiB | 0 / 0 | 0 |

No predefined `Offline` or `No models` label was present. The root's installed model API inspection returned five models, retaining Mac Ornith and four RTX aliases while excluding Chatterbox and S3Tokenizer. Optional remote capability routes and the event endpoint still returned HTTP 404. The profiler reports these transport failures and exits nonzero; they are not classified as document or JavaScript crashes.

Browser log: `/tmp/local-studio-installed-final2-browser-20260907.log`. Earlier bounded offline and recovery results, including the explicit unavailable labels, are in `status-readiness-2026-09-07.md`; the unchanged eleven-route sweep was not repeated for this targeted candidate.

## TARGET / NOT APPLIED — task evidence label acceptance

Read-only inspection of all eight existing acceptance run snapshots found 48 tasks and 139 acceptance criteria. Every existing criterion lacked `evidenceSource`; these are legacy records. The source renders distinct `Model reported · Not independently verified`, `Runtime observed`, and legacy labels. There was no actual new model-report criterion in this data to establish installed visual acceptance of that specific label. No task, criterion or model response was fabricated to satisfy this check. A subsequent real task must exercise that path before claiming it proven.

These page observations do not prove interactive task cancellation, same-tab reconnection, long-session stability, successful inference, or the new uncensored admission guard. Those require their separately coordinated acceptance steps.

## DECIDED / APPLIED — subsequent run deep-link fix

Source inspection during read-only acceptance found that `/runs?run=<id>` selected the requested record while retaining the default Current view. Completed and archived records were therefore hidden by the detail panel's visibility gate, despite being successfully loaded. The page now uses one typed view classifier for filtering, manual tab selection and initial deep-link routing. It waits for the requested record, opens its matching Current, History or Archived view, and consumes that query selection once. Subsequent polling cannot reset manual selection; a manual tab change also cancels a still-pending query selection. A changed run query remains a new navigation request.

MEASURED / PROVEN — scoped frontend TypeScript and ESLint passed. No automated tests were added. This fix is later than the `eb6f875f` build above and requires rebuilt installed acceptance before it is classified as proven product behavior.

## MEASURED / PROVEN — installed final2 long-session acceptance

The root engineer drove two independent scratch sessions through the authenticated installed frontend on port 50801 using `qwen-daily`. This acceptance used the final2 build pinned above (`eb6f875f9c2f81080c2848ff25a8ba2a8df3e267`), not an isolated SDK invocation or direct inference curl. Each session created its own random identity file. File contents were checked externally; neither identity is recorded here.

| Observation | Installed result |
| --- | --- |
| First archive, approximately 600,000 characters | Backend usage: 146,523 input + 267 output = 146,790 context tokens; successful completion below the 156,549-token threshold |
| Second archive, approximately 192,000 characters | Backend usage: 43,154 input + 146,789 cached input + 130 output = 190,073 context tokens |
| Automatic threshold compaction | `compaction_start`, reason `threshold`; bounded incremental fallback selected without a manual compact request |
| Summary work | `bounded-incremental-v1`, two segments, two attempts, 605,897 summary-input characters, 4,718 summary characters |
| Compaction settlement | `aborted: false`, `willRetry: false`, followed by `agent_settled`; session idle, no runtime error |
| Postcompaction accounting | Context tokens and percent became null until a new backend response; no false zero |
| Memory-only continuation | Exactly one tool call, `write`; no file read, listing, shell retrieval or supplied replacement nonce |
| Continuation result | `recall.txt` matched the session's original nonce externally and did not contain the other session's nonce; final backend total 55,236 tokens |

Independent read-only inspection of the canonical JSONL confirmed that all four original user messages remained stored when compaction completed. The summary retained the exact session identity, the integer-cents decision, pending rounding verification, cancellation context and `proof.txt` modification metadata. The recent second archive remained in the active context; the reduction to roughly 55K therefore does not imply that only the short summary was retained. Successful continuation establishes usable postcompaction memory for these concrete facts, not arbitrary long-context reasoning fidelity.

The root also cancelled session A's finite 45-second shell operation after its initial marker appeared, while session B completed its own nonce recall. The final cancellation sentinel remained absent after 76 seconds; independent inspection after compaction still found it absent. This proves cancellation and logical-session independence for that finite operation. It does not establish durable background-run resumability or every tool's cancellation semantics.

Private operator evidence is under `/tmp/local-studio-evidence-1396b57f-e577-466a-80c7-a42ead48a38b`; its session mapping is `/tmp/local-studio-manual-acceptance.json`. The canonical session has UUID `01a07a5a-779f-75e6-8e4a-4578c4739922`. The mirrored SDK configuration uses the global `~/.pi/agent/sessions` directory, so these new scratch UUID transcripts are outside the isolated acceptance user-data directory. Preserve them with the acceptance artifacts; no existing owner's transcript was replaced. Raw evidence and nonces remain private.

An operator-only observation caveat: the manual SSE cursor retained an earlier runtime's higher sequence after a runtime rebuild. Read-only monitoring recovered the compaction events using the correct sequence. The frontend already resets its cursor when a newly accepted runtime reports a lower sequence and when its connection key changes; this cursor incident is not evidence of a frontend regression.

## DECIDED / APPLIED — final4 provenance correction; restart acceptance pending

The later final4 candidate at `a950d463` is installed, according to the root installation receipt. It corrects the hybrid SDK context-count provenance discovered during the archive run: the pending first archive had been labeled 161,820 measured tokens, while its actual completed backend total was 146,790. The source preserves the conservative scheduling count while labeling estimated trailing context honestly.

The long-session results above belong to final2. Final4's installed restart, transcript reopening and post-restart behavior have not yet been accepted at this documentation checkpoint. Installation and source checks do not substitute for that remaining product acceptance.

## Final4 restart and visible workflow acceptance

**MEASURED / PROVEN — installed dev candidate a950d463, 2026-09-07.** After a clean process restart with the same isolated user-data directory, the compacted parent session resumed with the same canonical Pi ID. A memory-only request supplied no nonce and prohibited file reads. The model wrote the correct nonce into a new `recall-after-restart.txt`; external comparison passed, the other session's nonce was absent, and the cancellation sentinel remained absent. The turn settled without error at55,619 backend tokens. This extends the final2 automatic-compaction proof to process restart; it does not imply checkpointing an in-flight generation.

Manual Chrome interaction with the installed authenticated frontend confirmed that a completed Run deep-link opens its Tasks detail immediately. Its25 historical criteria visibly carry `Legacy evidence` and `Not independently verified`; no page exception occurred. The resumed long conversation rendered198,882 text characters with669 DOM nodes, no busy indicator, and document width equal to the1440px viewport. A later heap observation was15,334,440bytes; this is a point observation, not a leak study. The known uncensored profile was rejected before a read-only agent turn, with an actionable daily-profile message; the response currently uses HTTP500 despite representing a policy rejection.

Two actual child tasks were submitted together with separate Pi IDs and assigned scratch directories. They executed real tools and the document child wrote its artifact. However, the operator's Node fetch connection reached its independent approximately300-second response-header timeout and disconnected; both children then stopped. This is **not** a completed concurrency or coding acceptance. Source tracing also found that the frontend's generic Node fetch proxy has the same long-response exposure; a bounded subagent transport correction is required before repeating the acceptance. The first attempt and its artifacts are retained privately outside the repositories.

The initial document was596 words, contained the exact assigned nonce once in its footer, and excluded the sibling nonce. Manual content review **failed** it: release gates put context ahead of offline reliability, and the comparison table assumed that the current backend was already quality-qualified although the fictional brief had not established that. File existence and model-reported success are not a document-quality pass. A subsequent correction, if successful, must be recorded separately from first-attempt quality.

**SOURCE / NOT YET INSTALLED.** Policy rejection now carries a typed shared error and the turn boundary returns HTTP400 instead of500. The model remains unchanged and the actionable message remains the same. Runtime type checking passed; installed response verification follows the next candidate build.

## Final5 build and installation receipt; new acceptance pending

**MEASURED / PROVEN — source/build, 2026-09-07.** Final5 source is `69267982831e0af43024fd4a44b8e18fcf6b8716`. The root engineer completed `npm run check` successfully, followed by `npm --prefix frontend run desktop:dist:dev`. The required check includes frontend/controller static analysis and production builds; the final runtime build rewrote 347 relative specifiers. Logs are `/tmp/local-studio-readiness-check-final5-r2-20260907.log` and `/tmp/local-studio-readiness-build-final5-20260907.log`.

The initial final5 check caught removal of the public `browserHost` export, still referenced by the package entry point and existing browser persistence diagnostic. That one-line removal was reverted before the successful check. The public default host remains compatible; internal session-aware dispatch still uses the scoped resolver. The failed check is not counted as a passing gate.

| Final5 artifact | SHA-256 measured from generated archive |
| --- | --- |
| `frontend/dist-desktop-dev/CRIAs AI Dev-2.1.0-arm64-mac.zip` | `1e79b5c7853b47f1ba9030c988543759a9104847adbfaba9acdf9794733604d3` |
| `frontend/dist-desktop-dev/CRIAs AI Dev-2.1.0-arm64.dmg` | `aae680ae1fbef50e11fc00b063b1c899597208022b18646ee2581466e6bb4006` |

**DECIDED / APPLIED — live installation.** The documented installer replaced `/Applications/CRIAs AI Dev.app` and recorded `/Users/matheusbgodoi/Library/Application Support/Local Studio Installer/Rollbacks/CRIAs AI Dev.zip` as the rollback archive. Installation log: `/tmp/local-studio-readiness-install-dev-final5-20260907.log`. The Dev application was quit at this receipt checkpoint, pending coordinated acceptance. Stable application promotion is not claimed. Archive creation proves a rollback artifact exists; it does not prove a rollback execution.

**DECIDED / APPLIED — source changes included in the installation.** Browser state, cookies, fallback navigation and challenge memory now have session ownership; the visible pane addresses its focused conversation. A scoped startup semaphore protects environment injection through extension loading and restores prior values; ordinary inference is outside that startup lock. Completed child results and lifecycle records are persisted, while previously running children are marked interrupted after process restart rather than silently disappearing. Interrupted work is not automatically resumed. Long child POST responses use a 930-second transport budget around the existing 900-second task deadline, avoiding the earlier generic approximately 300-second response-header limit. Typed uncensored-profile policy rejection maps to HTTP 400 at the turn boundary. These are statements about the built implementation, not fresh installed acceptance results.

**TARGET / NOT YET PROVEN — final5 product acceptance.** Reopen the installed Dev candidate and verify actual concurrent browser-extension ownership, user-panel affinity, restart-visible child results/interrupted status, a child response surviving beyond the old transport limit, and installed policy rejection status. Independently verify generated coding/document artifacts and quality; preserve the earlier first-attempt document failure and interrupted child attempts. The final2/final4 results above remain valid for their exact tested versions and scenarios, but do not automatically qualify these new final5 paths. No application, browser, model or build was launched during this documentation-only receipt update.

## Final5 completed child coding and corrected-document acceptance

**MEASURED / PROVEN — installed final5, second attempts.** Two child tasks submitted together through the authenticated product endpoint completed with HTTP 200 and `ok: true`, after the transport correction. The React child used Pi ID `01a07aa4-47bf-79a5-9c29-01df24d60c9d` and took 604,396 ms (10.1 minutes). The document child used distinct Pi ID `01a07aa4-482a-765d-95a6-e670380632b9` and took 634,609 ms (10.6 minutes). These are high-thinking task wall times on the shared, serialized GPU, including queueing and tool work; they are not decode-speed measurements. Private request/result evidence is under `/tmp/local-studio-child-workorders-20260907/second-attempt`.

The root engineer independently rebuilt the actual generated React app with the offline Bun browser bundler: 12 modules, successful completion, 32 ms. Manual browser interaction at the loopback app on port 50891 with a 375 × 812 viewport returned HTTP 200 with no JavaScript errors or horizontal overflow. Whitespace-only input produced an accessible alert and `aria-invalid`; added labels were trimmed. Two tasks could be added and one completed, giving total/completed/remaining counts 2/1/1. Reload preserved their state and identical IDs. Unchecking and deleting produced 1/0/1; deleting the final task restored the empty state. This is externally observed interaction and build evidence, not acceptance inferred from the child's final response.

Independent read-only review of the generated document confirmed 641 words, the requested recommendation/gates/offline policy/concurrency policy/comparison table/two risks/rollback trigger, and explicit labels for unmeasured claims. The corrected gates put quality first and offline reliability second; the memo states the current backend's quality status is not established. It recommends holding candidate promotion and does not invent benchmark results or completed gates. **The corrected artifact passes this bounded writing brief; the first artifact remains a quality failure.** This is a response-to-feedback result, not a first-attempt pass or evidence of broad writing reliability.

Both saved implementation-nonce files matched their corresponding privately retained expected keys, and neither contained the sibling key. The document's own key appeared exactly once in its provenance footer, with no sibling key. Expected values were read internally for external comparison and are not recorded here. These checks verify actual artifact creation and separation for this workload; they do not establish filesystem sandboxing against malicious tools.

This completes the concrete React and corrected-document child acceptance that the earlier interrupted attempt could not establish, and proves successful responses beyond the former approximately 300-second transport ceiling. Browser-extension ownership, browser-profile cleanup and final6 restart acceptance remain separate pending checks. Two completed tasks and one corrected document do not establish a 99% daily-work success rate.


## Final6 restart discovery passes; browser isolation fails

**MEASURED / PROVEN — final6 installation.** The root completed the required full check, Dev build and official installation for source `b08bed25`. Generated ZIP SHA-256: `e056969d7a3174b2e3291cff3c9d04aaaa06c393c935957f51e971238438c17a`; DMG SHA-256: `1b9ba70f2cb2a6891a9caaa8f2e216a7a9d9c9179e8833c064f6bedc16047bca`. These are the root's archive receipts for that build, distinct from later source corrections.

After a fresh installed process restart, GET subagents returned HTTP 200 and restored both actual completed child records. Their saved result lengths were 2,741 and 2,418 characters, with original finish times `2026-09-07T07:03:06.115Z` and `2026-09-07T07:03:36.327Z`. Two earlier unfinished attempts appeared as `interrupted`, with null finish times and no invented result. Independent read-only inspection of `/tmp/local-studio-final6-restored-children.json` confirmed these fields. This qualifies persisted discovery/results after restart, not automatic task replay.

**MEASURED / PROVEN — browser isolation FAIL.** Actual browser child sessions `01a07ac1-3cd4-73b2-8fe9-f5f2c45e5c19` and `01a07ac1-3d46-7ea1-8203-76ec6fb32e12` completed with HTTP 200 in 123,974 and 130,906 ms. Tool traces contain 24 real calls, interleaved across three rounds; the first sequence navigated left at 07:25:45Z, right at 07:25:46Z, then read left at 07:25:47Z and right at 07:25:48Z. All three left output files contained the right page's key and URL. The three right files were correct. Neither HTTP success nor tool execution therefore establishes isolation. Keys remain private; evidence is `tool-order.json` and `external-checks.json` under `/tmp/local-studio-browser-child-workorders-20260907/installed-final6`.

Source tracing identified the SDK's same-working-directory cached extension factory returning a module whose browser-owner constant was initialized earlier. The startup semaphore did not refresh that cached module state. A later source correction captures typed browser/relay configuration and automation defaults inside every factory initializer. Manual calls through the actual SDK cached loader preserve separate request owners and model defaults, but installed repeat acceptance is still pending. See [browser ownership evidence](browser-session-ownership-2026-09-07.md). The final6 browser result remains a failure until a separately recorded new installation and real overlapping child run pass.

## Final9 build, installation and initial availability — 2026-09-07

MEASURED / PROVEN — the integrating checkout completed `npm run check` for source `9f2135d7`. The official Dev packaging and installer workflows then completed, and the root launched that candidate for isolated acceptance. Logs: `/tmp/local-studio-readiness-check-final9-20260907.log`, `/tmp/local-studio-readiness-build-final9-20260907.log`, `/tmp/local-studio-readiness-install-dev-final9-20260907.log`, and `/tmp/local-studio-readiness-launch-final9-20260907.log`. This receipt supersedes earlier installation checkpoints; it does not transfer their acceptance results to newly changed behavior.

Artifact manifest: `/tmp/local-studio-final9-artifacts.json`.

| Artifact | SHA-256 |
| --- | --- |
| CRIAs AI Dev-2.1.0-arm64-mac.zip | `854471142828dcfb4c68f52f6d5466f302a91a504eb331065e915e077dd4876c` |
| CRIAs AI Dev-2.1.0-arm64.dmg | `bd20882a2d9613eba8b3480afe7a2f27ae5b0d87df0d8f1d3f7fb2d63541c0f8` |

MEASURED / PROVEN — root's installed initial navigation reached `/agent` with HTTP 200 and zero busy indicators while challenger B was loading. Additional initial DOMContentLoaded observations were `/settings` HTTP 200 in 30 ms, `/runs` HTTP 200 in 30 ms, and `/models` HTTP 200 in 19 ms, each with zero `aria-busy` elements. These measurements establish initial availability only, not settled-screen correctness or a nine-second observation window.

DECIDED / APPLIED — the acceptance instance uses isolated user data. Only its settings were changed for the bounded challenger-B product campaign, with a private backup; normal Mac application settings were preserved. B product qualification was running at this checkpoint and is not yet a readiness or promotion result.

TARGET / NOT YET PROVEN — final9 includes the confirmed-late-close browser profile cleanup correction, but its actual installed child lifecycle has not yet qualified cleanup. The plain packaged-Node diagnostic was healthy; the installed product's earlier delayed close cause remains unresolved. Do not report cleanup PASS from packaging or that diagnostic. See [browser lifecycle evidence](browser-session-ownership-2026-09-07.md).
