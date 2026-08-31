import { computeHostStatus, wakeComputeHost } from "../compute-host-power";
import { computeHostById, getApiSettings } from "../settings-service";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleComputeHostsList(): Promise<Response> {
  const settings = await getApiSettings();
  const hosts = await Promise.all(
    settings.computeHosts.map((host) => computeHostStatus(host).catch(() => null)),
  );
  return json({ hosts: hosts.filter((host) => host !== null) });
}

export async function handleComputeHostStatus(id: string): Promise<Response> {
  const settings = await getApiSettings();
  const host = computeHostById(settings, id);
  if (!host) return json({ error: `Unknown compute host '${id}'.` }, 404);
  return json(await computeHostStatus(host, { force: true }));
}

export async function handleComputeHostWake(id: string): Promise<Response> {
  const settings = await getApiSettings();
  const host = computeHostById(settings, id);
  if (!host) return json({ error: `Unknown compute host '${id}'.` }, 404);
  const result = await wakeComputeHost(host);
  return json(result, result.accepted || result.reason === "already-online" ? 200 : 409);
}
