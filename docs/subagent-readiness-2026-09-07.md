# Subagent lifecycle — 2026-09-07

## Source changes

Ordinary subagents previously started with default full tool access and direct
network policy. They now inherit the parent's runtime options, with a distinct
browser session identity. Their persisted conversation is linked to its parent
before the first inference, so a failure cannot leave an unidentified child.

Request cancellation now reaches the child runtime. The existing 15-minute tool
request limit is also enforced in the runtime, including callers that omit a
client timeout. Cancellation aborts queued or active inference; a cancellation
during startup is checked before the first prompt. Success, startup failure and
inference failure all dispose the child and release its runtime-manager entry.

The HTTP boundary validates input with the shared Effect Schema and limits the
request body to 256 KB at both frontend and runtime. Four logical children per
parent remain supported. Their inference requests use background priority and
share the existing single GPU admission gate; their tools can run independently.

## Verification

Three deterministic offline checks in the existing agent-runtime test directory
passed: inherited restrictions/independent browser/early persisted ownership,
cancellation of a running child, and cleanup after startup failure. No backend
or live user session was involved. Runtime TypeScript passed before the commit.
Installed final5 completed two concurrent logical child tasks with independently verified coding/document artifacts; final6 restored their completed records after process restart. See [the installed candidate receipt](installed-candidate-2026-09-07.md). Child-specific cancellation during active work remains a separate acceptance requirement.

## Limits

These ordinary delegated tool calls retain a 15-minute lifetime and do not
automatically resume across a process restart. Their status and result discovery
now survive restart as described below. Durable Runs remain the product's
persistent long-task path. A completed model report is not proof that its claimed
shell or file actions occurred; acceptance still requires independently observed
artifacts and command results.

## Restart discovery — source and installed list restoration qualified

SOURCE INSPECTION: the old list endpoint read only a process-global map. Parent/name links and transcripts survived, but after restart the same parent returned an empty subagent list.

DECIDED / APPLIED in source: the existing locked, atomically replaced `agent-session-metadata.json` now also stores typed subagent records. Admission is recorded before runtime startup; canonical child identity is saved before inference; settlement saves status, task, cwd, timestamps and the existing bounded final-report preview. New run IDs use full UUIDs, and persisted identities are never regenerated. Live registry state is scoped to the data directory. The result remains a model report, not independently verified work.

A fresh process lists completed/error records with their original status and transcript link. A previously running record is shown as `interrupted`, with no invented finish time and explicit guidance to inspect partial work before starting a replacement. No request is replayed, no tools run during restoration and no automatic resume is claimed. Old parent/name-only metadata is still discoverable, with task/completion status explicitly unknown. Interrupted chips use a warning state instead of a green completion marker.

MEASURED / PROVEN: deterministic checks launched fresh Bun processes against temporary metadata files, restoring completed results and unfinished children, preserving records through an unrelated archive write, enforcing parent isolation, honoring child metadata deletion and recovering legacy links. Existing inherited-restriction, cancellation and startup-cleanup checks also passed. No model or live application request was sent. Installed final6 GET subagents returned both actual completed child records with saved results and original timestamps, plus interrupted prior attempts with null finish times. See [the final6 receipt](installed-candidate-2026-09-07.md). This proves restart/list discovery, not automatic task resumption or every transcript-navigation interaction.

Durable Runs remain the separate persistent long-task execution path. Metadata updates retain the existing version and file permissions; older binaries understand only the legacy links and can drop the added record map if they rewrite the store. Preserve the full user-data snapshot when rolling back.

## Long POST transport deadline

SOURCE FINDING: the frontend proxied the long-running subagent POST through global Node fetch. Waiting for the final result also meant waiting for response headers; the transport's independent header timer could end the request around five minutes despite the subagent's explicit fifteen-minute signal. The observed operator `HeadersTimeoutError` is a client transport failure, not evidence of GPU failure; its disconnect correctly cancelled the child.

DECIDED / APPLIED in source: only the subagent POST uses native Node HTTP/HTTPS with a bounded fifteen-minute-plus-thirty-second response envelope. Caller cancellation and downstream response cancellation still reach the upstream request. Other runtime proxy routes retain their existing transport. No dependency or background replay mechanism was added. [Node HTTP request documentation](https://nodejs.org/docs/latest-v22.x/api/http.html#httprequesturl-options-callback) documents the AbortSignal cancellation used here.

MEASURED / PROVEN offline: a hand-run `bun:test` check launches the actual Node frontend helper against temporary loopback endpoints and verifies delayed headers, response/status preservation, caller abort, explicit deadline and downstream stream disposal. Bun's own Node HTTP emulation did not implement these cancellation semantics in the initial probe; the qualifying process uses Node, matching the packaged frontend. This does not substitute for installed acceptance beyond the previous five-minute header boundary.

## Operational check contracts (source qualification)

DECIDED / APPLIED in source: durable plans may declare an exact command and workspace-relative cwd (expected exit code zero), or an exact file path and SHA-256. Plain acceptance strings remain model-reported assertions. The runtime assigns `model_declared` provenance and ignores proposed satisfaction/witness fields. A changed plan invalidates operational evidence rather than carrying it by description.

An execution owner is captured only for the exact working logical agent, its current RUNNING task, the matching unique RUNNING attempt, and the current plan revision. Conversation-level active-task guesses cannot produce this binding. New operational criteria also require a witness reference; the existing completion guard remains enforced.

Historical milestone boundary: raw execution capture and automatic witness writing were not yet applied here. They are now implemented and installed-qualified for the two supported check kinds in the final8 receipt below. These contracts alone did not restore autonomous executable acceptance. A genuine successful execution proves the declared check's outcome, not that a model-selected check adequately tests the owner's goal. Independent check provenance and tamper-resistant isolation are not implemented.

MEASURED / PROVEN: deterministic offline schema/provenance/ownership checks, existing control-plane/control-tool checks, and runtime TypeScript qualification. Installed acceptance remains separate.

## Raw operational witnesses (source qualification)

DECIDED / APPLIED in source: the public SDK bash definition now observes matching declared commands through `createLocalBashOperations`, preserving the configured shell path, command prefix, environment, streaming and cancellation. Exact command checks currently require cwd `.`; directory changes belong in the declared command. Unrelated commands use the SDK definition with the same child-environment credential filter and cannot satisfy another check. The runtime records the actual raw exit code before extension result rewriting; only zero without cancellation can pass. A null exit code is never success evidence.

`verify_file_criterion` accepts only a criterion id, reads its declared workspace file, and compares actual SHA-256 with the saved expected value. It rejects workspace escapes, non-regular files, files over 64 MiB, concurrent changes, and cancellation. Both observers bind to the exact task attempt and plan revision, append a fresh JSON witness artifact with outcome/digest/ownership, and reference that artifact from acceptance. A repeated check revokes its previous satisfaction before execution. Witness persistence failure cannot grant acceptance. There is no automatic writer for arbitrary description-only command/file/artifact criteria.

MEASURED / PROVEN offline: actual SDK shell execution with a configured shim and command prefix, raw exit zero/seven/null, unrelated successful commands, cancellation, plan changes during execution, exact file hashing, mismatched bytes, and automatic task settlement after both declared checks pass. The bounded campaign passed 55 checks / 167 assertions across five existing runtime test files. Runtime TypeScript passes. Installed product acceptance for these supported checks is now MEASURED / PROVEN in final8, recorded below; the earlier final7 admission failure remains part of the evidence.

The UI and working set expose the exact model-declared check and distinguish operational observation from independent goal verification. Observations describe the recorded moment: later edits can change a file or invalidate a prior build result. A model may select an inadequate check or alter project tests; this implementation does not certify semantic quality, protect evidence from arbitrary local filesystem writes, or create an owner-managed immutable acceptance policy. The earlier milestone's missing runtime writer is superseded by this section for the two supported specification kinds.

Qualification environment: `npm run check` completed contract/structure checks, frontend lint/type checks and the Next.js production compile, then stopped at the existing unsafe-standalone-link guard because this isolated checkout uses cross-worktree dependency symlinks. No guard was bypassed. The integrating checkout must run the full gate with its own dependency tree before packaging.

## Installed final7 admission failure and shell environment correction

MEASURED / PROVEN in installed acceptance: the planning tool supplied the SDK's raw model alias to a catalog lookup requiring the selected product model id. The run was rejected before creation. The fallback shell workflow also exposed an internal inference credential inherited from the runtime environment. No credential value is recorded here. That installed acceptance failed; source tests alone did not establish readiness.

DECIDED / APPLIED in source: the Pi runtime passes its selected catalog model id directly into the control extension; planning no longer derives admission identity from the SDK raw alias. Both ordinary bash and operational-witness bash now pass a copied, filtered environment to the public SDK local shell operation. Internal Local AI/Local Studio/Sitegeist/Pi credential variables and known inference/provider/Hugging Face credential names are omitted. PATH, the configured shell shim, command prefix, noncredential policy/session metadata, and ordinary project variables remain available. The parent environment is never changed by this filtering, avoiding cross-session mutation races.

MEASURED / PROVEN offline: 29 checks / 133 assertions across admission, operational witnesses, control tools and autonomous-flow suites. A separate child process received synthetic credentials only; actual ordinary and witness-producing shells verified their absence using exit status and retained project/policy variables. The probe emitted only a fixed success marker, never environment values. Runtime TypeScript and commit hooks are required; the integrating checkout owns the complete build and installed reacceptance.

LIMITATION: child-environment filtering is not a security sandbox. An agent with ordinary local file permissions can still access same-user files; it must not be described as isolated from all credentials. Credential rotation and handling already exposed transcript data belong to the separate operator remediation; this source change does not claim those actions occurred.


## Installed final8 operational Run acceptance — 2026-09-07

MEASURED / PROVEN through the installed application built from `0a208948`: Run `run_971b490f-67ee-417a-aa3c-69c43e79aebd` reached `COMPLETED`; its task reached `SUCCEEDED` on attempt one, plan revision one, with no replan event. The operator-provided exact command retained both internal-credential absence checks and the nonce write. Its runtime witness records exit code zero and `aborted: false`. Independent filesystem inspection confirmed the resulting 32 bytes exactly matched the operator's nonce and expected SHA-256. No nonce, command payload or credential value is reproduced here.

The file criterion was observed twice, both under `attempt_24732cf4-1be7-457c-917a-1ff142331086`, revision one, with the same successful expected-byte result. The root's installed browser acceptance recorded HTTP 200, two model-declared-check labels, two runtime-observed labels, two “not independently verified” labels, and zero page errors.

Private evidence is in `/tmp/local-studio-operational-run-retry-20260907/`: `detail.json`, `raw-witnesses.json`, `external-bytes.json`, `external-witness-checks.json`, `expected.json` and `accepted.json`. The admission response is only the initial acceptance signal; final completion and actual output are established by the later detail/witness/filesystem records. These private artifacts contain sensitive payloads and must not be copied verbatim into logs or repository documentation.

This demonstrates autonomous completion of the exact declared operational checks through the real product. The operator supplied the checks, but they entered through the model's plan API, so `model_declared` remains the correct stored/UI provenance. It does not certify independent semantic correctness of a general coding goal. The final7 failure and separate credential-remediation record remain valid; this successful repeat does not erase that incident or establish filesystem isolation.

## Explicit cancellation outcome correction

MEASURED / PROVEN — the installed final9 B-product R1 React child returned HTTP 200 with `ok: true` and 65 characters after the operator aborted its canonical runtime. Its persisted Pi session `01a07afd-188b-71d3-bde8-604e5167b1a4` ended at `2026-09-07T08:32:53.841Z` with an assistant message marked `stopReason: aborted` and an error message. The returned text exactly matched that aborted partial message. This was a product outcome-reporting defect, independently of the candidate's earlier repetitive tool behavior. Private receipt: `/tmp/phase5-b-product-workorders/installed-final9/react.result.json`.

ROOT CAUSE / SOURCE — the Pi turn observer propagated only `error` terminal reasons. The SDK can resolve an aborted prompt normally. The child runner then checked its outer HTTP request signal, which the separate runtime abort endpoint had not cancelled, and promoted partial assistant text to a completed result.

DECIDED / APPLIED — aborted terminal messages now propagate a typed cancellation, including cancellation observed after prompt settlement. Internal abort signals also normalize transport rejection to that cancellation. Deliberate cancellation leaves ordinary chat runtime `lastError` clear, bypasses context recovery, marks a child `interrupted`, and returns HTTP 499 instead of successful completion. Request-signal cancellation retains its non-success behavior. No aborted text is promoted to a child result.

MEASURED / PROVEN — the existing manually run deterministic offline lifecycle file passes nine checks, including empty and partial aborted assistant messages, listener cleanup and cancellation's ineligibility for compaction. Runtime TypeScript passes. Evidence: `/tmp/local-studio-abort-outcome-offline-20260907.log` and `/tmp/local-studio-abort-outcome-typecheck-20260907.log`. No test dependency, framework or CI/hook wiring was added. Installed cancellation acceptance is recorded below.


MEASURED / PROVEN — installed final10 source `d658f233` passed the actual cancellation repeat. The child first produced the exact externally checked readiness nonce. Manual runtime abort returned HTTP 200; the child request returned HTTP 499, its durable state was `interrupted`, and no completed result was present. The forbidden post-cancellation artifact remained absent 93.733 seconds after abort. A subsequent parent memory-only turn recalled its exact private nonce, establishing continuation of that parent after child cancellation. Parent Pi session: `01a07b19-3d30-7921-8f4d-d8f4325eebac`; child: `01a07b19-dcda-7a1a-ba5b-6a78bf069bb3`. Receipt: `/tmp/local-studio-final10-cancellation-receipt.json`; nonce values are intentionally omitted. This qualifies the concrete installed cancellation flow and supersedes the earlier pending cancellation status. Fresh-process restart discovery of this interrupted record and stable-channel launch remain separate acceptance steps.
