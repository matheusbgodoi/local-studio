# Installed candidate receipt — September 7, 2026

This is a chronological evidence ledger. Earlier pending statements describe their named milestone. The final installed state is [final11 native acceptance](#final11-stable-installation-and-native-electron-acceptance) below.

## MEASURED / PROVEN — source and build

Root worktree `/Users/matheusbgodoi/src/local-studio-readiness` was clean at `eb6f875f9c2f81080c2848ff25a8ba2a8df3e267` before and after these successful commands:

- `npm run check`: exit 0; static analysis, frontend production build, controller checks and runtime production build completed.
- `npm --prefix frontend run desktop:dist:dev`: exit 0; native dependency preparation, embedded frontend/runtime assertions and macOS archive/blockmap generation completed.

Logs: `/tmp/local-studio-readiness-check-final2-20260907.log` and `/tmp/local-studio-readiness-build-final2-20260907.log`.

App: `frontend/dist-desktop-dev/mac-arm64/CRIAs AI Dev.app`.

| Artifact                                                     | SHA-256                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `frontend/dist-desktop-dev/CRIAs AI Dev-2.1.0-arm64-mac.zip` | `5a29775cd54924d5465b37d23809525591fe78d50aa7e1b732177d3945e251a6` |
| `frontend/dist-desktop-dev/CRIAs AI Dev-2.1.0-arm64.dmg`     | `20c110d5d7e605858e77d0df73eafa678f2f13737413119886e63ea3d1456336` |

## DECIDED / APPLIED — installation scope

The root engineer installed the candidate through the documented installer and relaunched CRIAs AI Dev with isolated acceptance user data. The frontend served on loopback port 50801. Stable application data and production inference configuration were not changed by the browser diagnostic. This receipt covers the development installation, not promotion to the stable application.

## MEASURED / PROVEN — installed read-only acceptance

The existing authenticated `perf:browser` entrypoint observed each targeted route for nine seconds after load. Authentication was read from the isolated frontend token file into a loopback-scoped cookie; no credential or transcript was printed. No inference request was sent.

| Route     | Document              | FCP   | Browser task time | JS heap  | Uncaught / console errors | ARIA busy markers |
| --------- | --------------------- | ----- | ----------------- | -------- | ------------------------- | ----------------- |
| `/agent`  | HTTP 200, app scripts | 64 ms | 166.2 ms          | 13.7 MiB | 0 / 0                     | 0                 |
| `/models` | HTTP 200, app scripts | 80 ms | 125.3 ms          | 8.0 MiB  | 0 / 0                     | 0                 |
| `/runs`   | HTTP 200, app scripts | 84 ms | 106.9 ms          | 7.9 MiB  | 0 / 0                     | 0                 |

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

| Observation                                      | Installed result                                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| First archive, approximately 600,000 characters  | Backend usage: 146,523 input + 267 output = 146,790 context tokens; successful completion below the 156,549-token threshold                   |
| Second archive, approximately 192,000 characters | Backend usage: 43,154 input + 146,789 cached input + 130 output = 190,073 context tokens                                                      |
| Automatic threshold compaction                   | `compaction_start`, reason `threshold`; bounded incremental fallback selected without a manual compact request                                |
| Summary work                                     | `bounded-incremental-v1`, two segments, two attempts, 605,897 summary-input characters, 4,718 summary characters                              |
| Compaction settlement                            | `aborted: false`, `willRetry: false`, followed by `agent_settled`; session idle, no runtime error                                             |
| Postcompaction accounting                        | Context tokens and percent became null until a new backend response; no false zero                                                            |
| Memory-only continuation                         | Exactly one tool call, `write`; no file read, listing, shell retrieval or supplied replacement nonce                                          |
| Continuation result                              | `recall.txt` matched the session's original nonce externally and did not contain the other session's nonce; final backend total 55,236 tokens |

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

**DECIDED / APPLIED; subsequently installed-qualified.** Policy rejection carries a typed shared error and the turn boundary returns HTTP400 instead of500. The model remains unchanged and the actionable message remains the same. Runtime type checking passed; final10 stable HTTP admission verification is recorded below. Its missing visible error exposed a separate frontend defect, not a policy bypass.

## Final5 build and installation receipt; new acceptance pending

**MEASURED / PROVEN — source/build, 2026-09-07.** Final5 source is `69267982831e0af43024fd4a44b8e18fcf6b8716`. The root engineer completed `npm run check` successfully, followed by `npm --prefix frontend run desktop:dist:dev`. The required check includes frontend/controller static analysis and production builds; the final runtime build rewrote 347 relative specifiers. Logs are `/tmp/local-studio-readiness-check-final5-r2-20260907.log` and `/tmp/local-studio-readiness-build-final5-20260907.log`.

The initial final5 check caught removal of the public `browserHost` export, still referenced by the package entry point and existing browser persistence diagnostic. That one-line removal was reverted before the successful check. The public default host remains compatible; internal session-aware dispatch still uses the scoped resolver. The failed check is not counted as a passing gate.

| Final5 artifact                                              | SHA-256 measured from generated archive                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `frontend/dist-desktop-dev/CRIAs AI Dev-2.1.0-arm64-mac.zip` | `1e79b5c7853b47f1ba9030c988543759a9104847adbfaba9acdf9794733604d3` |
| `frontend/dist-desktop-dev/CRIAs AI Dev-2.1.0-arm64.dmg`     | `aae680ae1fbef50e11fc00b063b1c899597208022b18646ee2581466e6bb4006` |

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

| Artifact                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| CRIAs AI Dev-2.1.0-arm64-mac.zip | `854471142828dcfb4c68f52f6d5466f302a91a504eb331065e915e077dd4876c` |
| CRIAs AI Dev-2.1.0-arm64.dmg     | `bd20882a2d9613eba8b3480afe7a2f27ae5b0d87df0d8f1d3f7fb2d63541c0f8` |

MEASURED / PROVEN — root's installed initial navigation reached `/agent` with HTTP 200 and zero busy indicators while challenger B was loading. Additional initial DOMContentLoaded observations were `/settings` HTTP 200 in 30 ms, `/runs` HTTP 200 in 30 ms, and `/models` HTTP 200 in 19 ms, each with zero `aria-busy` elements. These measurements establish initial availability only, not settled-screen correctness or a nine-second observation window.

DECIDED / APPLIED — the acceptance instance uses isolated user data. Only its settings were changed for the bounded challenger-B product campaign, with a private backup; normal Mac application settings were preserved. B product qualification was running at this checkpoint and is not yet a readiness or promotion result.

TARGET / NOT YET PROVEN — final9 includes the confirmed-late-close browser profile cleanup correction, but its actual installed child lifecycle has not yet qualified cleanup. The plain packaged-Node diagnostic was healthy; the installed product's earlier delayed close cause remains unresolved. Do not report cleanup PASS from packaging or that diagnostic. See [browser lifecycle evidence](browser-session-ownership-2026-09-07.md).

## Final10 packaging and installed cancellation — 2026-09-07

MEASURED / PROVEN — root completed the required `npm run check` and both official Dev/stable desktop builds for source `d658f233`. The official Dev installer completed, and the installed isolated acceptance application passed the cancellation workflow described below. Receipts: `/tmp/local-studio-readiness-check-final10-20260907.log`, `/tmp/local-studio-readiness-build-final10-20260907.log`, `/tmp/local-studio-readiness-build-stable-final10-20260907.log`, `/tmp/local-studio-readiness-install-dev-final10-20260907.log`, and `/tmp/local-studio-readiness-launch-final10-20260907.log`. Source checks and archive creation do not establish installed stable-channel behavior.

Artifact SHA-256 manifest: `/tmp/local-studio-final10-artifacts.json`.

| Artifact                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| CRIAs AI Dev-2.1.0-arm64-mac.zip | `164a9ef12621e64046c0df5dbb43faa0e949602ff155064965cf48010ee9024c` |
| CRIAs AI Dev-2.1.0-arm64.dmg     | `ad764d46d360b612e0865fc248b940bb4d13140488c379122cb8b05e99148455` |
| CRIAs AI-2.1.0-arm64.dmg         | `f34eb9a9539c3663ea307b5b62bfc83ae68e79043082f42cb1fa60b575d98413` |
| CRIAs AI-2.1.0-arm64-mac.zip     | `4a55f58706846f381c7145184a6d8a553f656f09c32519108542bf465201702e` |

MEASURED / PROVEN — the installed Dev child cancellation repeat returned abort HTTP 200 and child HTTP 499, persisted `interrupted` with no result, and left its forbidden post-cancellation artifact absent after 93.733 seconds. Both the child's readiness nonce and subsequent parent's memory-only recall matched independent expectations. This verifies the correction for final9's aborted-partial-text false success; see [subagent cancellation evidence](subagent-readiness-2026-09-07.md#explicit-cancellation-outcome-correction) and `/tmp/local-studio-final10-cancellation-receipt.json`. No nonce value is included in this document.

MEASURED / PROVEN — the official stable installer completed and installed `/Applications/CRIAs AI.app`, preserving its installer-managed rollback archive. Receipt: `/tmp/local-studio-readiness-install-stable-final10-20260907.log`. After a fresh Dev restart, the cancellation record was rediscovered with HTTP 200, `interrupted`, no result, and its original finish timestamp `2026-09-07T09:01:55.427Z`; `/tmp/local-studio-final10-cancellation-restart.json` supersedes the earlier pending restart state. This proves discovery of that interruption, not automatic resumption.

MEASURED / PROVEN — a headless browser using the installed stable frontend/runtime submitted an image to `qwen-daily`, thinking Off, in session `01a07b27-880b-7cb2-940e-e7ddc0d076d7`. The exact expected digits were returned, visible in the browser, with a normal `stop`, no model error and zero uncaught browser errors. Timestamp-derived submission-to-completion time was 42.133 seconds; this is not a TTFT or image-encoding-only measurement. Receipt: `/tmp/local-studio-stable-final10-vision-receipt.json`.

MEASURED / PROVEN — a subsequent text-only request in the same image-history session returned the correct capital with normal completion in 40.906 seconds, measured from timestamps. That request supplied no new image while retaining the previous image in history. Receipt: `/tmp/local-studio-stable-final10-text-after-image.json`. These checks qualify the concrete installed stable text/Vision path, not general Vision quality or native Electron preference behavior.

TARGET / NOT YET PROVEN — final11 installation, native Electron CDP preference/selection acceptance and the revised admission-error/default-selection UI still require separate verification. A headless browser shares the installed HTTP frontend/runtime but has its own origin storage and lacks the native preload bridge; its successful requests do not prove the Electron renderer's selected/default profile.

## Stable admission feedback correction — source checkpoint

MEASURED / PROVEN — root's fresh headless browser context against the installed final10 stable frontend automatically selected an uncensored model whose custom physical-model label hid the restricted behavior profile. This browser lacked the native Electron preference bridge; it was not evidence that the native application had stored an uncensored default. Sending a turn produced the correct backend HTTP 400 admission rejection with an actionable explanation, but the composer cleared and the visible chat showed only the user message. Source tracing found that the submit handler already stored the rejection in the conversation's `error` field; ChatPane never rendered that field. A legacy restricted default also made the physical group's existing default pin inert, obstructing an explicit same-model repair to Standard.

DECIDED / APPLIED — the active chat now renders its stored error as an accessible alert beside the composer. A rejected submission restores the draft unless the user has already entered newer text; the existing assistant-identity guard preserves a superseding turn. The alert remains in the conversation state until the next deliberate action clears it; this does not introduce durable server-side storage for rejected requests. Restricted picker identity uses the shared policy helper, independently of customized display names. The selected restricted profile is visibly named Uncensored and unavailable for agents, its behavior/model rows cannot be chosen, and selection dispatch also refuses it. A legacy restricted default offers an explicit pin action to set the physical group's safe primary profile as default. The application never silently changes the existing selection or default; direct gateway catalogs are unchanged.

MEASURED / PROVEN — frontend TypeScript and scoped ESLint completed with no errors. No frontend tests were added. Evidence: `/tmp/local-studio-admission-feedback-typecheck.log` and `/tmp/local-studio-admission-feedback-lint.log`. Installed final11 acceptance is pending: verify a legacy restricted selection still receives HTTP 400, displays the alert, retains its draft, shows the restricted identity, and allows explicit default repair. The isolated acceptance origin's legacy default can be represented by the plain model-ID value at localStorage key `local-studio.agent.defaultModel`; pane/session model selections are independently stored under `local-studio.agent.paneState`. Normal stable settings were not modified by this source change.

DECIDED / APPLIED — source tracing established a second cause for the fresh-browser selection: `chooseModelId` chose the first active catalog row, even if its profile was restricted. Automatic selection now considers only allowed profiles, preferring an active declared default profile, then another active allowed model, then a declared default allowed profile, then another allowed model. A catalog containing only restricted profiles leaves automatic selection empty. Explicit current/preferred IDs, including restricted or temporarily absent IDs, remain unchanged for visible user repair; no stored choice is silently replaced.

MEASURED / PROVEN — root inspected native Electron preferences separately and found its saved default was Ornith, not uncensored. The fresh headless browser's automatic selection must not be reported as the native saved default. Electron backs up the plain string key `local-studio.agent.defaultModel` in `<userData>/ui-preferences.json`. Renderer hydration first consults controller `persisted.ui_preferences`, then the Electron bridge, and fills only missing localStorage entries. An existing renderer-origin value therefore is not replaced merely by editing the backup file. No native or headless preference was changed by this source follow-up. Frontend TypeScript and scoped lint pass; installed fresh-default selection acceptance remains pending.

## Native default durability correction — source checkpoint

MEASURED / PROVEN — root used native Electron CDP on final10 to choose Qwen Standard as the default. The renderer's localStorage changed and a fresh native chat selected Daily, but `ui-preferences.json` still contained Ornith minutes later. This establishes a missing durable-save trigger, distinct from the fresh headless browser's earlier automatic-selection defect. The model preference helper wrote storage directly; the existing durable-save scheduler was otherwise triggered by unrelated global UI-store activity.

DECIDED / APPLIED — explicit model-default writes now invoke the existing debounced durable preference save when, and only when, the supplied storage is the browser's actual `window.localStorage`. Existing retired-alias migration routes its write through the same helper. Ephemeral memory storage and server-side execution do not schedule a save. The existing backup mechanism remains the sole owner of controller/desktop persistence; no duplicate persistence format or preference authority was added.

MEASURED / PROVEN — frontend TypeScript and scoped ESLint pass. Evidence: `/tmp/local-studio-durable-default-typecheck.log` and `/tmp/local-studio-durable-default-lint.log`. No frontend tests or live preference changes were made. Actual native Electron UI selection followed by matching durable file contents remains pending in the rebuilt installation.

## Final11 stable installation and native Electron acceptance

MEASURED / PROVEN — source `3c44bf000759ebb04fb0f9a788d6e78ba1427d21` passed the complete `npm run check`, then both official Dev and stable desktop distribution builds. Both packages were installed with `scripts/install-desktop-app.sh`; no git hook was bypassed. Logs: `/tmp/local-studio-readiness-check-final11-r4-20260907.log`, `/tmp/local-studio-readiness-build-final11-r4-20260907.log`, `/tmp/local-studio-readiness-build-stable-final11-20260907.log`, and the corresponding `install-dev-final11` / `install-stable-final11` logs. Exact four archive hashes and sanitized native acceptance are preserved in [the committed receipt](evidence/final11-native-acceptance-2026-09-07.json).

MEASURED / PROVEN — manual Playwright CDP attached to the actual installed Electron renderer, including its native preload bridge, with temporary listeners verified bound only to `127.0.0.1`. This is native acceptance, unlike the earlier separate headless HTTP browser:

- Isolated Dev data reproduced a stored restricted default. The picker visibly identified it as unavailable for agents. An actual rejected turn returned HTTP 400, displayed its actionable explanation, and restored the exact submitted text in the composer, with zero uncaught JavaScript exceptions.
- The restricted behavior row was disabled. The same physical model's Standard default action remained enabled and repaired the preference explicitly. No silent replacement of an existing conversation model was used.
- With the isolated default deliberately empty, a fresh native conversation automatically selected Qwen Standard, with no restricted warning.
- The model-default UI action updated both native renderer storage and `ui-preferences.json`. In the real stable user-data directory, a fresh process restart retained Qwen Standard and XHigh; native Settings loaded with zero busy markers. Existing conversation model choices were preserved.
- A fresh stable scratch conversation executed a real write tool. External byte comparison verified its random nonce, the UI displayed `READY`, and no uncaught exception occurred. The accepted Pi session was `01a07b40-6825-7320-bb07-e25aaa11ef97`. The receipt's 29.219-second observation time is an upper bound after submission, not measured decode latency or TTFT. The short acceptance used Off; the original XHigh preference was restored afterwards.

DECIDED / APPLIED — `/Applications/CRIAs AI.app` now contains final11 and was relaunched normally without remote-debugging flags. The Dev acceptance application and temporary debug listeners were stopped. Qwen Standard is the native default; the inference Golden was not replaced.

MEASURED / PROVEN — the official stable installer used a separate `Rollbacks/final10-before-final11` directory. The original pre-promotion rollback archive remains byte-identical at SHA256 `dea7df6fdef7ea9387438d2e0d9bc67ef35e1489b3161e1a0a8a1f0da0b55de3`; its CRC and bundle identity were previously verified. This proves archive preservation/integrity, not a reinstall of that old client. Backend Golden restoration was actually executed and verified repeatedly in the paired inference campaign. The private pre-promotion user-data/session recovery snapshot remains under `Local Studio Installer/Recovery/production-readiness-20260907`.

Remaining limits are deliberate: browser-profile cleanup can retain a profile when the actual browser close never settles; full Windows desktop reserve is below the campaign's 512 MiB floor; optional gateway capability requests still return 404; physical sleep/wake and same-tab Retry were not fully accepted. Golden stable Vision took 42.133 seconds, and a text-only follow-up retaining the image took 40.906 seconds. The qualified task examples do not prove arbitrary long-running job resumability or a 99% daily-task success rate. B's installed near-context compaction was not qualified and B was not promoted. No old model/recovery artifact was deleted.

## Phase 5 inherited execution-policy correction — stable native acceptance

MEASURED / PROVEN — source `1462a09a` passed `npm run check` and all 390 deterministic agent-runtime tests (1,271 assertions, 45 files). The official stable package was built and installed with `scripts/install-desktop-app.sh stable`. The installed application is `/Applications/CRIAs AI.app`; artifact and rollback hashes are in [the sanitized acceptance receipt](evidence/policy-inheritance-native-acceptance-2026-09-07.json). Build, check and install logs are `/tmp/local-studio-readiness-build-stable-policy-r4-20260907.log`, `/tmp/local-studio-readiness-check-policy-r4-20260907.log`, and `/tmp/local-studio-readiness-install-stable-policy-r4-20260907.log`.

DECIDED / APPLIED — Standard remains the global default. Uncensored is enabled in the behavior picker and has no agent-unavailable label. A session captures its model alias, behavior profile and network policy; ordinary/nested/background subagents and durable Run agents inherit the snapshot. Session summaries, canonical replay metadata and durable rows preserve it. Reopening history hydrates those values before continuation, while a loading replay cannot submit with temporary defaults.

MEASURED / PROVEN — native Electron CDP observed an Uncensored/VPN parent, child and grandchild using the same `qwen-uncensored`, `uncensored`, and `vpn_protected` values. Independent nonce files proved both descendant shells received `LOCAL_STUDIO_NETWORK_POLICY=vpn_protected`, reached the same VPN exit and differed from a direct Mac request. After an application/runtime restart, the real history row restored the Uncensored alias and VPN policy; a continuation reused the same Pi session and independently produced a VPN-routed nonce.

MEASURED / PROVEN — while that protected parent remained resident and kept the physical tunnel active, a separate Standard/Direct parent and child reported `qwen-daily`, `standard`, and `direct`. Its independent network nonce matched the Mac's direct exit and differed from the VPN exit. This qualifies per-execution routing rather than the earlier process-wide protected-wins behavior. No exit address or credential is stored in the receipt.

The acceptance campaign found and fixed three defects before this pass: protected shell creation racing tunnel startup, protected shell commands missing proxy environment, and reopened history reconstructing Standard/Direct before canonical replay. The earlier final11 admission restriction and its “unavailable for agents” UI are historical and superseded by this section.
