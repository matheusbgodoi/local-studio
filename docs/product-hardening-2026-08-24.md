# Product hardening — 2026-08-24

This document tracks the owner-facing product review requested from the installed desktop app. Every area must be researched, implemented, and independently validated. Empty or unsupported controller capabilities must never be presented as broken primary workflows.

## 1. Profile and phone

- Decide whether the legacy KittyLitter controller pairing still has an owner-facing purpose now that Local Studio has tailnet-only PWA pairing.
- Consolidate mobile access around the working Local Studio URL and masked token-copy flow.
- Keep controller-wide grants only if they are clearly labeled as a separate advanced integration.
- Acceptance: the common phone workflow is understandable without knowing what KittyLitter or a controller is; no token reaches the renderer or DOM.

## 2. General settings, updates, and controllers

- Make the fork/release update channel honest and prevent an upstream update from replacing owner functionality while tailnet publishing remains enabled.
- Remove or demote manual controller registration and SSH deployment when the owner installation already manages its controller automatically.
- Acceptance: the page explains the active release and connection in owner language; no action appears useful when its backend cannot support it.

## 3. System settings

- Replace indefinite loading, `Fallback`, `Unknown`, and raw 404 responses with capability-aware states.
- Show only engines, services, storage, hardware, and compatibility data the active controller can actually report.
- Acceptance: no permanent spinner, no raw endpoint error, and every unavailable section explains whether it is unnecessary or unsupported.

## 4. Shortcuts and dictation

- Add a configurable global dictation shortcut with toggle and hold-to-talk modes.
- Reuse the existing on-device dictation pipeline and expose permission/readiness state.
- Audit additional high-value owner shortcuts without crowding the page.
- Acceptance: press-to-toggle and hold-to-talk both stop reliably, never type into the wrong target, and expose conflicts accessibly.

## 5. Setup

- Reclassify optional Sitegeist relay as optional rather than a blocker.
- Keep only first-run checks that can prevent Local Studio from completing a real task.
- Acceptance: a healthy owner installation reports ready even without optional relay infrastructure.

## 6. Status telemetry and analysis

- Add useful time-series graphs for GPU utilization, VRAM, power, temperature, decode throughput, prefill throughput, TTFT, requests, and queue state.
- Support time range and metric selection without presenting stale values as live.
- Add whole-host power and efficiency only when measured by a real supported source, keeping GPU telemetry primary.
- Acceptance: graph labels, units, sampling window, unavailable states, and data provenance are explicit.

## 7. Status controls and identity

- Remove the confusing empty Models menu or turn it into a capability-backed model switcher.
- Rename destructive lifecycle actions so `Stop` states exactly whether it stops inference, unloads a model, or stops the controller.
- Replace internal aliases such as `qwen-daily`, `qwen-uncensored`, `ornith-turbo`, and `gemma-write` with official model identities in owner-facing UI.
- Aggregate Standard/Uncensored and effort levels into the same physical-model telemetry.
- Acceptance: controls predict their effect before activation and metrics never split one checkpoint into fake models.

## 8. Model library identity and logos

- Display official model names throughout Local, status, Runs, Usage, and selectors.
- Add locally bundled, license-compatible visual identities for Qwen, Ornith, and Gemma with a neutral fallback.
- Preserve aliases only as advanced technical details where required for routing.
- Acceptance: official identity is consistent across every owner-facing surface.

## 9. Serves

- Determine whether owner-managed launch recipes are supported by the active controller.
- Hide or demote the Serves tab when `/recipes` is unavailable; never render a permanent 404 workflow.
- Acceptance: the Models page contains no unreachable primary tab.

## 10. Run retention and cleanup

- Add explicit archive/hide/delete lifecycle for durable Runs, with safe handling of associated tasks, agents, activity, and internal rollout sessions.
- Define a calm default view that prioritizes active and recent Runs without silently deleting history.
- Acceptance: completed Runs remain recoverable until the owner deletes them, and cleanup cannot affect another chat or active Run.

## 11. Run concurrency and the single inference slot

- Reconcile logical multi-agent execution with the one-card, one-decode-at-a-time host.
- Make concurrent logical agents visibly scheduled rather than implying simultaneous GPU inference.
- Surface queued, working, idle, paused, and blocked states using measured scheduler state.
- Acceptance: no overlapping request is lost, no agent is falsely shown generating, and the UI explains the shared inference slot.

## 12. Automations and owner workflows

- Validate scheduling, persistence, restart recovery, notifications, and manual run-now behavior.
- Make connected capabilities discoverable when creating an automation.
- Support useful owner workflows for image generation, email, calendar, WhatsApp, and Instagram where a stable authorized API exists; use browser automation only with explicit limitations and safe session handling.
- Acceptance: each automation declares the account/tool it needs before activation and fails closed when unavailable.

## 13. Configure overview and machines

- Remove raw `/studio/rigs` errors and make the owner topology truthful.
- Keep Machines only if it clearly represents additional compute hosts; treat the automatically managed 3090 controller as the current system rather than `0 machines`.
- Acceptance: Overview summarizes the actual installation and routes only to working configuration pages.

## 14. Server health and logs

- Make controller, inference, process, and GPU-monitoring health distinguishable.
- Populate available log streams or state precisely why logging is unavailable.
- Acceptance: an empty log panel is never mistaken for a broken server and sensitive values are redacted.

## 15. API reference

- Fix capability detection and the OpenAPI route, or remove the primary API Docs affordance when the active controller does not publish a spec.
- Acceptance: opening API Docs never ends at an unexplained HTTP 404.

## 16. Plugins

- Explain `Unavailable`, `Adapter needed`, and `Setup` with direct next actions.
- Separate bundled Local Studio integrations from Codex plugins that require a compatibility adapter.
- Acceptance: every plugin row is actionable or clearly informational; no apparent error is merely an unsupported adapter path.

## 17. Connectors and catalog growth

- Make adding a connector understandable without writing internal JSON or knowing MCP transport details.
- Provide guided setup for known connectors and a validated advanced custom MCP path.
- Clarify enabled, connected, disabled, available, and unhealthy states.
- Acceptance: the owner can discover, configure, test, enable, disable, and remove a connector without exposing credentials.

## Release gate

- Preserve the currently running app and Run until the owner releases them.
- Complete static checks and the optional on-device title helper probe before packaging.
- Validate all changed surfaces in the installed desktop app and the iPhone PWA.
- Run a final adversarial review, correct confirmed findings, merge through a PR into `dev`, and follow the repository release convention.
