//
// What has to be thrown away when the boundary moves.
//
// The jail is applied at spawn time, so it binds a process for that process's
// life and cannot be applied to one already running. Every long-lived thing the
// runtime keeps — the Chromium context, pooled MCP connector processes, open
// PTYs — therefore carries the policy that was in force when it started.
//
// Left alone, a Chromium launched in Direct would go on serving a protected
// session over the machine's own route while the status read PROTECTED, and a
// connector process started while protected would keep a jail that no longer
// applies once the owner returns to Direct. An adversarial review found all
// three. So a transition in either direction drops them, and the next use
// rebuilds them under the policy in force then.
//
// This lives apart from the service so that `network/service.ts` does not have
// to import the browser host, the connector pool and the PTY service — the
// service decides WHEN, and this decides WHAT.
//

import { closeAllPooledConnections } from "../connector-pool";
import { playwrightManager } from "../browser-host/playwright";
import { closeAllPtySessions } from "../pty-service";

export function resetBoundaryScopedResources(): void {
  try {
    playwrightManager.stop();
  } catch {
    // a browser that will not close must not stop the rest from being dropped
  }
  try {
    closeAllPooledConnections();
  } catch {
    // same
  }
  try {
    closeAllPtySessions();
  } catch {
    // same
  }
}
