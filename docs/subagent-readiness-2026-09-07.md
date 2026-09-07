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

These ordinary delegated tool calls retain an in-memory run registry and a
15-minute lifetime; their transcripts and parent links persist, but they do not
automatically resume across a process restart. Durable Runs remain the product's
persistent long-task path. A completed model report is not proof that its claimed
shell or file actions occurred; acceptance still requires independently observed
artifacts and command results.
