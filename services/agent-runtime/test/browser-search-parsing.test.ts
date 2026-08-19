import { afterEach, describe, expect, test } from "bun:test";
import {
  clampMaxResults,
  clearSearchCache,
  normalizeHits,
  parseDdgHtml,
  parseDdgLite,
  unwrapRedirect,
  webSearch,
} from "../src/browser-host/search";

// DuckDuckGo's no-JavaScript frontends are HTML PAGES, not an API. Their markup
// can change under us at any time, so every assertion here runs against captured
// fixtures rather than the live provider: a network flake must never turn into a
// red test, and a red test must always mean the parser is wrong.

const REDIRECT = (target: string): string =>
  `//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}&amp;rut=abc123`;

const DDG_HTML = `
<html><head><title>llama.cpp github at DuckDuckGo</title></head><body>
<div class="results">
  <div class="result results_links results_links_deep result--ad">
    <a class="result__a" href="//duckduckgo.com/y.js?ad_provider=x&amp;u=https%3A%2F%2Fsponsor.example">Sponsored thing</a>
    <a class="result__snippet">Buy the thing</a>
  </div>
  <div class="result results_links results_links_deep web-result">
    <a class="result__a" href="${REDIRECT("https://github.com/ggml-org/llama.cpp")}">ggml-org/llama.cpp: LLM inference in C/C++</a>
    <a class="result__snippet">LLM inference in C/C++. Contribute to <b>ggml-org/llama.cpp</b> development.</a>
  </div>
  <div class="result results_links results_links_deep web-result">
    <a class="result__a" href="${REDIRECT("https://github.com/ggml-org/llama.cpp/")}">llama.cpp &mdash; duplicate target</a>
    <div class="result__snippet">Same page, trailing slash.</div>
  </div>
  <div class="result results_links results_links_deep web-result">
    <a class="result__a" href="${REDIRECT("https://github.com/ggml-org/llama.cpp/discussions")}">Discussions &middot; ggml-org/llama.cpp</a>
    <a class="result__snippet">Ask questions &amp; discuss.</a>
  </div>
  <div class="result results_links results_links_deep">
    <a class="result__a" href="//duckduckgo.com/?q=llama.cpp&amp;ia=web">More results</a>
  </div>
</div>
</body></html>`;

const DDG_LITE = `
<html><head><title>llama.cpp github</title></head><body><table>
<tr><td><a class="result-link" href="${REDIRECT("https://github.com/ggml-org/llama.cpp")}">ggml-org/llama.cpp</a></td></tr>
<tr><td class="result-snippet">LLM inference in C/C++.</td></tr>
<tr><td><a class="result-link" href="${REDIRECT("https://llama-cpp-python.readthedocs.io/")}">llama-cpp-python docs</a></td></tr>
<tr><td class="result-snippet">Python bindings.</td></tr>
</table></body></html>`;

const DDG_CHALLENGE = `
<html><head><title>Just a moment...</title></head>
<body><div id="cf-wrapper"><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>
<h1>Checking your browser before accessing duckduckgo.com</h1></div></body></html>`;

afterEach(() => {
  clearSearchCache();
  delete globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST;
  delete globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST;
});

describe("destination extraction", () => {
  test("unwraps the provider's redirect to the real target", () => {
    expect(unwrapRedirect(REDIRECT("https://example.com/a?b=1"))).toBe("https://example.com/a?b=1");
  });

  test("drops provider navigation that goes nowhere useful", () => {
    expect(unwrapRedirect("//duckduckgo.com/?q=x&ia=web")).toBeNull();
  });

  test("keeps a direct absolute result untouched", () => {
    expect(unwrapRedirect("https://example.org/page")).toBe("https://example.org/page");
  });

  test("refuses a non-http scheme", () => {
    expect(unwrapRedirect(REDIRECT("javascript:alert(1)"))).toBeNull();
  });
});

describe("HTML frontend", () => {
  test("reads the ordinary results", () => {
    const hits = parseDdgHtml(DDG_HTML);
    expect(hits.map((hit) => hit.url)).toEqual([
      "https://github.com/ggml-org/llama.cpp",
      "https://github.com/ggml-org/llama.cpp/",
      "https://github.com/ggml-org/llama.cpp/discussions",
    ]);
  });

  test("decodes entities in titles and snippets", () => {
    const hits = parseDdgHtml(DDG_HTML);
    expect(hits[2]?.title).toBe("Discussions · ggml-org/llama.cpp");
    expect(hits[0]?.snippet).toBe("LLM inference in C/C++. Contribute to ggml-org/llama.cpp development.");
  });

  test("leaves the sponsored block out", () => {
    expect(parseDdgHtml(DDG_HTML).some((hit) => hit.url.includes("sponsor.example"))).toBe(false);
  });

  test("an empty page yields no results rather than a guess", () => {
    expect(parseDdgHtml("<html><body><p>Nothing here.</p></body></html>")).toEqual([]);
  });

  test("malformed markup does not throw", () => {
    expect(() => parseDdgHtml('<div class="results_links"><a class="result__a" href=')).not.toThrow();
    expect(parseDdgHtml('<div class="results_links"><a class="result__a" href=')).toEqual([]);
  });
});

describe("Lite frontend", () => {
  test("pairs each link row with its snippet row", () => {
    expect(parseDdgLite(DDG_LITE)).toEqual([
      {
        title: "ggml-org/llama.cpp",
        url: "https://github.com/ggml-org/llama.cpp",
        snippet: "LLM inference in C/C++.",
      },
      {
        title: "llama-cpp-python docs",
        url: "https://llama-cpp-python.readthedocs.io/",
        snippet: "Python bindings.",
      },
    ]);
  });

  test("an empty page yields no results", () => {
    expect(parseDdgLite("<html><body></body></html>")).toEqual([]);
  });
});

describe("normalisation", () => {
  test("collapses targets that differ only by trailing slash", () => {
    const results = normalizeHits(parseDdgHtml(DDG_HTML), 8);
    expect(results.map((result) => result.url)).toEqual([
      "https://github.com/ggml-org/llama.cpp",
      "https://github.com/ggml-org/llama.cpp/discussions",
    ]);
  });

  test("keeps the engine's order and numbers from one", () => {
    const results = normalizeHits(parseDdgHtml(DDG_HTML), 8);
    expect(results.map((result) => result.rank)).toEqual([1, 2]);
    expect(results[0]?.domain).toBe("github.com");
  });

  test("honours the result ceiling", () => {
    expect(normalizeHits(parseDdgHtml(DDG_HTML), 1)).toHaveLength(1);
  });

  test("drops a hit with no title", () => {
    expect(normalizeHits([{ title: "", url: "https://a.example", snippet: "" }], 8)).toEqual([]);
  });
});

describe("result ceiling", () => {
  test("defaults to eight", () => {
    expect(clampMaxResults(undefined)).toBe(8);
  });

  test("caps at fifteen", () => {
    expect(clampMaxResults(500)).toBe(15);
  });

  test("rejects nonsense without throwing", () => {
    expect(clampMaxResults("banana")).toBe(8);
    expect(clampMaxResults(-3)).toBe(8);
  });
});

// The provider is stubbed at the reader's transport hook, so these exercise the
// real fetch/parse/cache path without a packet leaving the machine.
function stubProvider(pages: Record<string, { status: number; body: string }>): string[] {
  const seen: string[] = [];
  globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST = async () => [
    { address: "93.184.216.34", family: 4 as const },
  ];
  globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST = async (url: string) => {
    seen.push(url);
    const host = new URL(url).host;
    const page = pages[host] ?? { status: 404, body: "" };
    return {
      status: page.status,
      ok: page.status >= 200 && page.status < 300,
      url,
      contentType: "text/html; charset=utf-8",
      body: page.body,
    };
  };
  return seen;
}

describe("provider strategy", () => {
  test("uses the HTML frontend and does not touch Lite when it works", async () => {
    const seen = stubProvider({ "html.duckduckgo.com": { status: 200, body: DDG_HTML } });
    const outcome = await webSearch("llama.cpp github");
    expect(outcome.provider).toBe("ddg-html");
    expect(outcome.results).toHaveLength(2);
    expect(seen.some((url) => url.includes("lite.duckduckgo.com"))).toBe(false);
  });

  test("falls back to Lite exactly once when HTML yields nothing", async () => {
    const seen = stubProvider({
      "html.duckduckgo.com": { status: 200, body: "<html><body></body></html>" },
      "lite.duckduckgo.com": { status: 200, body: DDG_LITE },
    });
    const outcome = await webSearch("llama.cpp github");
    expect(outcome.provider).toBe("ddg-lite");
    expect(outcome.results).toHaveLength(2);
    expect(seen.filter((url) => url.includes("lite.duckduckgo.com"))).toHaveLength(1);
  });

  test("a challenged provider is reported, not hammered", async () => {
    const seen = stubProvider({
      "html.duckduckgo.com": { status: 403, body: DDG_CHALLENGE },
      "lite.duckduckgo.com": { status: 403, body: DDG_CHALLENGE },
    });
    const outcome = await webSearch("anything");
    expect(outcome.results).toEqual([]);
    expect(outcome.verificationRequired?.verificationRequired).toBe(true);
    expect(seen).toHaveLength(2);
  });

  test("the cooldown stops the very next attempt from leaving the machine", async () => {
    const seen = stubProvider({
      "html.duckduckgo.com": { status: 429, body: "" },
      "lite.duckduckgo.com": { status: 429, body: "" },
    });
    await webSearch("first");
    const before = seen.length;
    const second = await webSearch("second");
    expect(seen.length).toBe(before);
    expect(second.results).toEqual([]);
  });
});

describe("cache", () => {
  test("an identical query inside the window does not re-fetch", async () => {
    const seen = stubProvider({ "html.duckduckgo.com": { status: 200, body: DDG_HTML } });
    await webSearch("llama.cpp github");
    const first = seen.length;
    const again = await webSearch("  LLAMA.CPP   GitHub ");
    expect(seen.length).toBe(first);
    expect(again.cached).toBe(true);
    expect(again.results).toHaveLength(2);
  });

  test("an expired entry is re-fetched", async () => {
    const seen = stubProvider({ "html.duckduckgo.com": { status: 200, body: DDG_HTML } });
    const start = 1_000_000;
    await webSearch("llama.cpp github", 8, start);
    const later = await webSearch("llama.cpp github", 8, start + 11 * 60_000);
    expect(later.cached).toBe(false);
    expect(seen.length).toBe(2);
  });

  test("an empty answer is not cached", async () => {
    const seen = stubProvider({
      "html.duckduckgo.com": { status: 200, body: "<html><body></body></html>" },
      "lite.duckduckgo.com": { status: 200, body: "<html><body></body></html>" },
    });
    await webSearch("nothing here");
    const before = seen.length;
    await webSearch("nothing here");
    expect(seen.length).toBeGreaterThan(before);
  });
});
