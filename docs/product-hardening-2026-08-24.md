# Product hardening — 2026-08-24

This document tracks the owner-facing product review requested from the installed desktop app. Every area must be researched, implemented, and independently validated. Empty or unsupported controller capabilities must never be presented as broken primary workflows.

## Status language

- `READY`: implementation and installed acceptance evidence both exist.
- `CODED — UNVALIDATED`: implementation exists, with static evidence only; it is not in the installed app yet.
- `DEPENDENCY`: completion needs hardware, credentials, provider authorization, signing identity, or an external deployment.
- `REFUSED`: the requested result cannot be represented honestly or safely with the available source.
- `MISSING`: no sufficient implementation exists yet.

No item in the table below becomes `READY` merely because it compiles. The current owner app and the active 3090 inference process must remain untouched until the owner releases them for packaging and live acceptance.

## Review protocol

Each numbered area below passed through the same three roles requested by the owner:

1. **Research** traced the current UI, controller contract, capabilities, persistence, and external dependencies.
2. **Engineering** implemented only behavior supported by those contracts, keeping unsupported features hidden or explicitly unavailable.
3. **Validation** reviewed the resulting code adversarially for stale controller state, misleading capability fallbacks, secret exposure, unsafe mutations, and owner-facing regressions.

This is one cross-cutting triad applied to every area, not three independent implementations of the same feature. Its evidence is static until the release gate is opened. The final branch-wide static review completed with no confirmed blocker, high, or medium finding left open; that verdict does not replace packaged or live acceptance.

## Current truth

| Area | Status | Static evidence | Installed evidence | Dependency, limitation, and next step |
| --- | --- | --- | --- | --- |
| Profile and phone | CODED — UNVALIDATED | Legacy controller pairing removed in `734dbfd2`; mobile access is exposed through the masked-token desktop footer. | The earlier tailnet pairing flow worked, but this cleanup is not installed. | Package later; verify that the secret never reaches the renderer or DOM and that desktop and PWA pairing still work. |
| General, updates, controllers | CODED — UNVALIDATED | Owner-release update protection and two-step confirmation exist through `f88f9a74`; deploy output is redacted before IPC in `33bf8864`; manual deploy is demoted to Advanced. | Not accepted against a real fork update after this batch. | Package later; verify the owner channel cannot be replaced by an upstream update while tailnet publishing is active. |
| System | CODED — UNVALIDATED | Capability-aware states exist in `fa3a19c8`, `ee412bfc`, and `47c5dbc2`; controller state is scoped in `fbfc9715`; unsupported data is not fabricated. | Not accepted against both capable and limited controllers. | Verify no stale controller frame, permanent spinner, or raw endpoint error. |
| Shortcuts and dictation | CODED — UNVALIDATED | Global toggle and hold-to-talk dictation, readiness, and permission handling are implemented from `de55c5a8` through `2fec53b2`. | The helper and both modes have not been exercised in the next package. | Package later; verify target ownership, conflicts, permission denial, toggle stop, and hold release. Additional global shortcuts remain a product decision. |
| Setup | CODED — UNVALIDATED | Sitegeist is optional and only required checks count as blockers; owner copy now points to Settings → General. | Not accepted in the next package. | Verify a healthy owner install reports ready with no relay. |
| Status telemetry | CODED — UNVALIDATED | Trends originate in `de92de55`; `a51fb75a` isolates controller/process epochs and `856021cc` samples only observed payloads. `bbfef796`, stack commit `aad1e95`, and `af047761` bind completed-request performance to the resident physical model and process start epoch, including PID reuse. GPU utilization, VRAM, board power, and temperature are live samples; decode, prefill, and TTFT are timestamped observations from the latest completed request; active requests come from the live engine slot state. | No next-package graph acceptance yet. | Queue depth is unavailable from the current gateway and stays explicitly unavailable. Whole-PC power is `DEPENDENCY`: it requires a real wall meter or UPS source. Estimated TDP or GPU+CPU sums are refused. |
| Status controls and identity | CODED — UNVALIDATED | Lifecycle actions say “Unload model”; `f29a66a1` capability-gates lifecycle and recipe controls; `cd90e113` and `3d1637db` keep physical identity and behavior profiles separate. | Not accepted in the next package. | Verify a controller without lifecycle/recipes exposes no action destined to fail and no internal routing alias. |
| Model identity and logos | CODED — UNVALIDATED for names; REFUSED for unlicensed logos | Qwen3.8-27B, Ornith-1.5-35B-A3B, and Gemma 4 26B A4B are the owner identities; routing aliases remain technical metadata. | Not accepted everywhere in the next package. | Neutral bundled monograms remain until each official asset has source, immutable version, redistribution permission, and brand guidance. Model/code licenses do not grant logo rights. |
| Launch profiles | CODED — UNVALIDATED | `c8c6c5d7` replaces owner-facing “Serves” language with Launch profiles; `f29a66a1` gates Recipes separately from Lifecycle. | Not accepted against capability combinations. | Verify Recipes=yes/Lifecycle=no and Recipes=no/Lifecycle=yes without 404s or reachable invalid mutations. |
| Run retention | CODED — UNVALIDATED | Current, History, Archived, restore, and terminal-only delete exist; internal rollout sessions stay out of chat navigation. | Earlier Run surfaces worked, but the final retention batch is not installed. | Verify active/completed/archive/restore/delete and chat isolation after packaging. |
| Run concurrency | CODED — UNVALIDATED | `4195c3dc` establishes one inference boundary; `22faaef7` exposes queued/generating phases and one shared inference slot. | Not accepted under two competing logical agents in the next package. | Verify no two agents are labeled generating simultaneously and interactive work receives the documented priority. |
| Automations | CODED — UNVALIDATED for the scheduler; MISSING for requested write workflows | Persistence/recovery and required connections exist from `2eed5baf` through `1a0c84b6`; claims, deletion, settlement, and retry are serialized and durable. | Not accepted across restart and manual Run now. | Gmail and Calendar are read-only. Image, email/calendar write, WhatsApp, and Instagram workflows require separate authorized mutation designs and an idempotent action ledger. |
| Configure and Machines | CODED — UNVALIDATED | Capability-aware overview exists in `ee412bfc` and `ae4e1c0a`; `fbfc9715` scopes controller state and identity. | Not accepted against the owner topology. | Verify the managed 3090 is described as the current system and unsupported extra-machine APIs are not shown as broken. |
| Server health and logs | CODED — UNVALIDATED; DEPENDENCY on stack deployment | The 3090 stack branch has bounded, allowlisted, redacted journal endpoints in `1412312` through `8f5ce9a`; `c038d031` isolates frontend sessions and `33bf8864` protects deploy output. | The gateway changes are not deployed. | Merge/deploy only after the active inference process is released; then validate every stream and redaction boundary. |
| API reference | CODED — UNVALIDATED | Capability gating and the explicit valid-but-empty state in `d2acf1c2` prevent an unexplained empty panel. | Not accepted against supported, empty, and unsupported controllers. | Verify unsupported hides the affordance and no owner path ends in a raw 404. |
| Plugins | CODED — UNVALIDATED | `6a806d73` separates everyday integrations from developer-only adapters and adds actionable state copy. | Gmail/Calendar setup and adapter states are not accepted in the next package. | Credentials and provider consent remain external dependencies. |
| Connectors | CODED — UNVALIDATED for custom MCP; MISSING for Meta workflows | Guided custom connector create/test/enable/disable/remove exists in `f088de4c` and `9f965454`; remote MCP traffic is protected under VPN policy. | Not accepted end to end in the next package. | WhatsApp personal scraping and unattended browser posting are refused. Official WhatsApp Cloud and Instagram Graph integrations require the owner’s Meta app, scopes, webhook/public callback design, and explicit mutation policy. |

### Cross-cutting release state

- `/copy`, `/export:file`, `/export:clipboard`, native save, local titles, conversation-project moves, archived deletion, Run ownership, and the compact Run strip are coded but remain subject to the same package-and-acceptance gate.
- `--cache-reuse 256` is configured in the generated Qwen launch command, but remains unvalidated on the custom llama.cpp fork. It changes no prompt text and is reversible, but only a controlled restart and cache observation can establish whether it works in this stack.
- Stable macOS privacy identity and the owner-facing permissions name remain dependent on an Apple Developer ID; renaming the disk image does not create a stable signing identity.

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

- Add time-series graphs for GPU utilization, VRAM, power, temperature, completed-request decode/prefill/TTFT observations, and live active-request state. Show queue state only when a controller actually reports it.
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

## 9. Launch profiles

- Determine whether owner-managed launch recipes are supported by the active controller.
- Hide or demote Launch profiles when `/recipes` is unavailable; never render a permanent 404 workflow.
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
