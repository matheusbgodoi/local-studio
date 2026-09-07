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
