import { closeAllPooledConnections } from "../connector-pool";
import { stopBrowserManagers } from "../browser-host/playwright";
import { closeAllPtySessions } from "../pty-service";

export function resetBoundaryScopedResources(): void {
  try {
    stopBrowserManagers();
  } catch {}
  try {
    closeAllPooledConnections();
  } catch {}
  try {
    closeAllPtySessions();
  } catch {}
}
