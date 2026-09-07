//
// Whether the alternative browser backend exists on this machine.
//
// The composer used to show a backend switch unconditionally — embedded panel
// versus Sitegeist relay — in the slot right next to the model picker. With no
// relay configured, which is the default, that control switched to a backend
// that was not there, and its two icons (a panel, then an eye) read as some
// unexplained mode toggle. It was mistaken for the network control.
//
// So it is only offered when the runtime says a relay is actually configured.
// One request, at most once per page: a capability does not change while the
// app is open, and nothing here polls.
//

let state: boolean | null = null;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

type SetupCheck = { id?: unknown; ok?: unknown };

async function load(): Promise<boolean> {
  try {
    const response = await fetch("/api/agent/setup-checks", { cache: "no-store" });
    const payload = (await response.json()) as { checks?: SetupCheck[] };
    const check = payload.checks?.find((entry) => entry.id === "sitegeist-relay");
    return check?.ok === true;
  } catch {
    //
    // Unreachable runtime means unknown, and unknown resolves to "do not offer
    // it". Showing a control that may switch to nothing is the outcome this
    // exists to avoid.
    //
    return false;
  }
}

export function subscribeBrowserBackendAvailability(listener: () => void): () => void {
  listeners.add(listener);
  if (state === null && !inflight) {
    inflight = load().then((value) => {
      state = value;
      inflight = null;
      for (const notify of listeners) notify();
      return value;
    });
  }
  return () => listeners.delete(listener);
}

export function getBrowserBackendAvailability(): boolean {
  return state === true;
}
