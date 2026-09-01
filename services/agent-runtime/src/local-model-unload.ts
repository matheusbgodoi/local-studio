import { getApiSettings } from "./settings-service";

//
// Hand the RAM back when the app closes.
//
// A local inference server keeps the model resident so the next question is
// fast, which is right while the app is open and wrong the moment it is not:
// on a 24 GB machine a 9B model is a third of the memory, held for an app the
// owner has already quit. The idle timer would get there eventually; quitting
// is a clearer statement than idleness and should not have to wait for it.
//
// Only loopback controllers are touched. A model on the RTX is that machine's
// business — its own governor decides when to unload — and reaching across the
// network to unload someone else's model on our way out would be overreach.
//
const UNLOAD_TIMEOUT_MS = 4_000;

function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

type ModelListing = { data?: Array<{ id?: unknown }> };

async function unloadAt(baseUrl: string): Promise<number> {
  const base = baseUrl.replace(/\/+$/, "");
  const listed = await fetch(`${base}/v1/models`, {
    signal: AbortSignal.timeout(UNLOAD_TIMEOUT_MS),
  });
  if (!listed.ok) return 0;
  const payload = (await listed.json()) as ModelListing;
  const ids = (payload.data ?? [])
    .map((row) => row?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  let unloaded = 0;
  for (const id of ids) {
    try {
      const response = await fetch(`${base}/v1/models/${encodeURIComponent(id)}/unload`, {
        method: "POST",
        signal: AbortSignal.timeout(UNLOAD_TIMEOUT_MS),
      });
      if (response.ok) unloaded += 1;
    } catch {
      // A server that will not unload must not keep the app from exiting.
    }
  }
  return unloaded;
}

/** Best effort, and bounded: shutdown is not the place to wait on the network. */
export async function unloadLocalModels(): Promise<void> {
  try {
    const settings = await getApiSettings();
    const urls = new Set<string>();
    for (const controller of settings.controllers) {
      if (isLoopback(controller.url)) urls.add(controller.url);
    }
    if (isLoopback(settings.backendUrl)) urls.add(settings.backendUrl);
    await Promise.all([...urls].map((url) => unloadAt(url).catch(() => 0)));
  } catch {
    // Never block the exit.
  }
}
