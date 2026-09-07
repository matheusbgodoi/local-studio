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
Installed cancellation and concurrent-tool acceptance remain pending.

## Limits

These ordinary delegated tool calls retain a 15-minute lifetime and do not
automatically resume across a process restart. Their status and result discovery
now survive restart as described below. Durable Runs remain the product's
persistent long-task path. A completed model report is not proof that its claimed
shell or file actions occurred; acceptance still requires independently observed
artifacts and command results.

## Restart discovery — source qualified, installed acceptance pending

SOURCE INSPECTION: the old list endpoint read only a process-global map. Parent/name links and transcripts survived, but after restart the same parent returned an empty subagent list.

DECIDED / APPLIED in source: the existing locked, atomically replaced `agent-session-metadata.json` now also stores typed subagent records. Admission is recorded before runtime startup; canonical child identity is saved before inference; settlement saves status, task, cwd, timestamps and the existing bounded final-report preview. New run IDs use full UUIDs, and persisted identities are never regenerated. Live registry state is scoped to the data directory. The result remains a model report, not independently verified work.

A fresh process lists completed/error records with their original status and transcript link. A previously running record is shown as `interrupted`, with no invented finish time and explicit guidance to inspect partial work before starting a replacement. No request is replayed, no tools run during restoration and no automatic resume is claimed. Old parent/name-only metadata is still discoverable, with task/completion status explicitly unknown. Interrupted chips use a warning state instead of a green completion marker.

MEASURED / PROVEN: deterministic checks launched fresh Bun processes against temporary metadata files, restoring completed results and unfinished children, preserving records through an unrelated archive write, enforcing parent isolation, honoring child metadata deletion and recovering legacy links. Existing inherited-restriction, cancellation and startup-cleanup checks also passed. No model or live application request was sent. Root must still qualify installed restart/list/transcript navigation.

Durable Runs remain the separate persistent long-task execution path. Metadata updates retain the existing version and file permissions; older binaries understand only the legacy links and can drop the added record map if they rewrite the store. Preserve the full user-data snapshot when rolling back.
