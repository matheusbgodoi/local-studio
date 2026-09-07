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

TARGET / NOT APPLIED at this milestone: raw execution capture and automatic witness writing. These contracts alone do not restore autonomous executable acceptance. A genuine successful execution proves the declared check's outcome, not that a model-selected check adequately tests the owner's goal. Independent check provenance and tamper-resistant isolation are not implemented.

MEASURED / PROVEN: deterministic offline schema/provenance/ownership checks, existing control-plane/control-tool checks, and runtime TypeScript qualification. Installed acceptance remains separate.
