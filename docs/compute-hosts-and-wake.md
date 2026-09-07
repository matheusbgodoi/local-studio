# Compute hosts and waking them

**IMPLEMENTED.** `shared/agent/compute-host.ts`,
`services/agent-runtime/src/compute-host-power.ts`,
`frontend/src/features/settings/compute-hosts-section.tsx`.

A compute host is a machine that serves inference and that CRIAs can ask about
its own power state. It is not the same thing as a controller: the controller
is where models are served from, the host is the box those models run on, and
the two answer on different ports for different reasons.

Configured in Settings → System → Compute hosts.

## What CRIAs reads

The owner's RTX box already ran a control server before any of this existed —
`iot-home-control`'s `shutdown_server.py`, token-authenticated, reachable over
the tailnet. CRIAs did not add a second one; it reads the one that was there.

`GET /gpu/status` distinguishes three states that matter, and the mapping is:

| Control server says | CRIAs shows | Meaning |
|---|---|---|
| `gateway: false` | Game mode | The AI stack is stopped and the VRAM is free |
| `gateway: true`, no model | Gateway up, no model | Idle, loads on first request |
| `gateway: true`, model named | Model resident | Ready to answer now |
| no answer | Asleep or off | Nothing is listening |

The probe has a four second timeout, is cached for eight seconds, and cannot
throw. A host that is not there must never be able to block the surface that
renders it.

## Two addresses, one host

The tailnet address works from anywhere and is always tried first. The LAN
address is tried **exactly once** after it fails, and never in a loop.

That fallback is not redundancy for its own sake: it is the evening the
internet is down and the power is not. This Mac is still home, the host is
still on, and there is no reason for the panel to go dark. A host that is
genuinely asleep, on the other hand, should be reported unreachable quickly
rather than retried into a stall — which is why the fallback is one attempt.

## Two ways to wake it, and why neither is Tailscale

Waking is the one operation that cannot go over the tailnet. Tailscale is
software running on the target, and a powered-off machine runs nothing.

| Method | Works from | Costs |
|---|---|---|
| HTTP bridge | anywhere | a key exposed on the public internet, and a third device |
| LAN magic packet | the target's own network | nothing |

The bridge goes first because it answers from anywhere. It is a Pico W that
lives on the target's LAN permanently and sends the packet on request — see
`matheusbgodoi/iot-home-control`. Its URL carries the key that authorises the
wake, so it is stored in the ignored settings file, never committed, and
redacted to origin and path before it reaches a log.

The magic packet is the fallback. CRIAs builds it itself — six `0xFF` bytes
followed by the target MAC repeated sixteen times, 102 bytes total — and sends
it to the configured broadcast address on ports 9 and 7. It needs no secret and
no third device, but it only reaches the host while both share a broadcast
domain.

**MEASURED.** The packet was checked against the wire rather than asserted: 102
bytes, correct sync stream, correct MAC ×16, captured off the LAN.

Neither method returns an acknowledgement from the host. A success means the
request left, not that the machine woke. Readiness is decided by polling the
control server until it answers or the timeout expires — 180s by default,
because a cold start on this hardware runs one to two minutes.

## Not sending it twice

Each method is tried once per wake. A wake is single-flight per host, and a
cooldown of 90 seconds is persisted across restarts, so a double click or two
agents deciding at once cannot produce two attempts.

A magic packet is harmless to repeat — a machine already on ignores it — so
this is not the safety property it would be for a power-button pulse. It is
politeness toward an endpoint that sits on the public internet.

## Rollback

Remove the host from Settings, or delete the `computeHosts` array from
`api-settings.json` in the data directory. Nothing else in CRIAs depends on it,
and the RTX host is unaffected either way.
