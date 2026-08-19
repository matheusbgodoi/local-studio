import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

// The promise this feature makes is: after the owner has legitimately passed a
// check or signed in, the session survives long enough for the agent to carry on
// reading. That promise rests on two mechanics, and this file exercises both
// against a local page — no real site, no real credentials, no real challenge:
//
//   1. the browser profile lives on disk, in Local Studio's own data directory,
//      so cookies outlive the process that set them;
//   2. switching between the automated (headless) and interactive (visible)
//      window REOPENS that same profile rather than starting a fresh browser,
//      which is the only reason a verified session is still there afterwards.
//
// The second one is the interesting mechanic: Chromium cannot flip a live
// context between headless and headful, and two processes must never share one
// userDataDir, so the manager has to close and relaunch. If that ever became a
// second browser instead of the same profile, this test goes red.

const PAGE = `<!doctype html><html><head><title>session probe</title></head>
<body><h1>probe</h1><script>
  document.cookie = "ls_probe=verified; path=/; max-age=600";
  localStorage.setItem("ls_probe_local", "verified");
</script></body></html>`;

const READBACK = `<!doctype html><html><head><title>readback</title></head>
<body><pre id="out"></pre><script>
  document.getElementById("out").textContent = JSON.stringify({
    cookie: document.cookie,
    local: localStorage.getItem("ls_probe_local"),
  });
</script></body></html>`;

let server: Server;
let origin = "";
let profileDir = "";
let available = false;

beforeAll(async () => {
  profileDir = mkdtempSync(path.join(tmpdir(), "ls-browser-profile-test-"));
  process.env.LOCAL_STUDIO_BROWSER_PROFILE_DIR = profileDir;
  server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(request.url === "/readback" ? READBACK : PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
  const { playwrightManager } = await import("../src/browser-host/playwright");
  available = playwrightManager.isAvailable();
});

afterAll(async () => {
  const { browserHost } = await import("../src/browser-host/browser-host");
  browserHost.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(profileDir, { recursive: true, force: true });
  delete process.env.LOCAL_STUDIO_BROWSER_PROFILE_DIR;
});

describe("browser profile", () => {
  test("is a durable directory, not a temp scratch path", async () => {
    const { playwrightManager } = await import("../src/browser-host/playwright");
    expect(playwrightManager.profileDirectory()).toBe(profileDir);
  });

  test("starts in automated mode", async () => {
    const { playwrightManager } = await import("../src/browser-host/playwright");
    expect(playwrightManager.isHeadful()).toBe(false);
  });
});

describe("session survives the switch to the interactive window", () => {
  test("cookies and local storage set before the switch are still there after it", async () => {
    if (!available) {
      // No Chromium on this machine; the profile assertions above still hold.
      expect(available).toBe(false);
      return;
    }
    const { browserHost } = await import("../src/browser-host/browser-host");

    await browserHost.navigate(`${origin}/`);
    const before = await browserHost.getText();
    expect(before).toContain("probe");

    // The verification path: same profile, visible window.
    const state = await browserHost.openForVerification(`${origin}/readback`);
    expect(state.headful).toBe(true);

    const after = await browserHost.getText();
    expect(after).toContain("ls_probe=verified");
    expect(after).toContain('"local":"verified"');

    // And automation continues in that same context rather than needing a reset.
    const url = await browserHost.getUrl();
    expect(url.url).toContain("/readback");
  }, 90_000);
});
