//
// A fetch() that can only reach the tunnel.
//
// Remote MCP connectors — Gmail, Calendar, anything the owner adds over HTTP —
// used to be REFUSED while protection was on, because they reach node's global
// fetch, which takes no agent and so cannot be pointed anywhere. Refusing was
// safe but it was a functional hole, and it turns out to be avoidable: built on
// node:https instead, the request accepts an Agent, and the Agent is the one
// from proxy-agent.ts whose only socket factory is the CONNECT tunnel.
//
// FAIL-CLOSED IS STRUCTURAL, not a check. There is no branch in this file that
// dials a destination: every socket comes from the agent, the agent's
// createConnection only ever opens a tunnel, and with the tunnel down the
// request throws ECONNREFUSED against loopback. Nothing falls back.
//
// The two obvious alternatives were measured and rejected. Node's global fetch
// does honour a `dispatcher`, but node 22 bundles undici 6 internally while this
// package tree has undici 8, and the handler ABI no longer matches
// (`InvalidArgumentError: invalid onRequestStart method`). NODE_USE_ENV_PROXY
// works, but it is process-wide and bootstrap-only, it routes loopback as well,
// and NO_PROXY does not honour CIDR — so the Tailscale model backend could not
// be exempted, and inference would have been dragged through the VPN.
//
// This is the same category as the reader and browser_search: routed in code,
// not confined by the kernel. It widens that category rather than shrinking it,
// which docs/protected-networking.md §10 says out loud.
//

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { proxyAgents } from "./proxy-agent";

const MAX_REDIRECTS = 20;

//
// Statuses whose response carries no body at all. Handing `new Response` a
// stream for these throws.
//
const NO_BODY = new Set([101, 103, 204, 205, 304]);

async function bodyBytes(init: RequestInit | undefined): Promise<Buffer | undefined> {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), "utf8");
  //
  // Blob, FormData, ReadableStream: let the standard Request do the parsing
  // rather than reimplementing multipart encoding here.
  //
  return Buffer.from(await new Response(body as BodyInit).arrayBuffer());
}

function collectHeaders(raw: NodeJS.Dict<string | string[]>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const one of value) headers.append(key, one);
    else if (value !== undefined) headers.append(key, value);
  }
  return headers;
}

export function tunnelledFetch(endpoint: string): typeof fetch {
  //
  // Its own agent pair, not the cached one the reader uses. Those cap at eight
  // sockets, and StreamableHTTP holds a standing SSE stream per connection plus
  // one per in-flight call — measured, the ninth same-origin request never got a
  // response. Node's global fetch has no such cap, so sharing the pool would
  // have been a regression rather than a neutral port.
  //
  const agents = proxyAgents(endpoint, "streaming");

  const once = (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    redirectsLeft: number,
  ): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      void (async () => {
        const url = new URL(typeof input === "string" ? input : String((input as Request).url ?? input));
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return reject(new TypeError(`unsupported protocol ${url.protocol}`));
        }
        const secure = url.protocol === "https:";
        const send = secure ? httpsRequest : httpRequest;

        const headers = new Headers(init?.headers);
        let payload: Buffer | undefined;
        try {
          payload = await bodyBytes(init);
        } catch (error) {
          return reject(error);
        }
        if (payload && !headers.has("content-length")) {
          headers.set("content-length", String(payload.length));
        }
        //
        // Identity encoding: the body is handed on as a live stream, and a
        // compressed one would have to be buffered to be decoded, which is
        // exactly what an SSE channel must not do.
        //
        if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
        if (!headers.has("host")) headers.set("host", url.host);

        const outHeaders: Record<string, string> = {};
        headers.forEach((value, key) => {
          outHeaders[key] = value;
        });

        const req = send({
          protocol: url.protocol,
          host: url.hostname,
          port: url.port || (secure ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: (init?.method ?? "GET").toUpperCase(),
          headers: outHeaders,
          agent: secure ? agents.https : agents.http,
          ...(secure ? { servername: url.hostname } : {}),
        });

        const signal = init?.signal;
        const onAbort = (): void => {
          req.destroy(signal?.reason ?? new Error("aborted"));
        };
        if (signal) {
          if (signal.aborted) {
            req.destroy();
            return reject(signal.reason ?? new Error("aborted"));
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }
        const release = (): void => signal?.removeEventListener("abort", onAbort);

        req.once("error", (error: Error) => {
          release();
          reject(error);
        });

        req.once("response", (res) => {
          const status = res.statusCode ?? 0;
          const responseHeaders = collectHeaders(res.headers);
          const location = responseHeaders.get("location");
          const mode = init?.redirect ?? "follow";

          if (location && status >= 300 && status < 400 && mode !== "manual") {
            res.resume();
            release();
            if (mode === "error") return reject(new TypeError("unexpected redirect"));
            if (redirectsLeft <= 0) return reject(new TypeError("too many redirects"));
            const nextInit: RequestInit = { ...init, headers };
            const method = (init?.method ?? "GET").toUpperCase();
            //
            // A 303, and a 301/302 on a POST, become a GET without a body —
            // the standard fetch behaviour the MCP SDK expects.
            //
            if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
              nextInit.method = "GET";
              delete nextInit.body;
              headers.delete("content-length");
            }
            return resolve(once(new URL(location, url).toString(), nextInit, redirectsLeft - 1));
          }

          //
          // Handed over as a live web stream rather than buffered, which is what
          // lets an SSE channel deliver events as they arrive. Measured: chunks
          // arrive at the server's emit interval, not all at once on close.
          //
          const stream = NO_BODY.has(status) ? null : (Readable.toWeb(res) as ReadableStream);
          const response = new Response(stream, {
            status,
            statusText: res.statusMessage ?? "",
            headers: responseHeaders,
          });
          Object.defineProperty(response, "url", { value: url.toString(), configurable: true });
          release();
          resolve(response);
        });

        if (payload) req.write(payload);
        req.end();
      })();
    });

  return ((input: RequestInfo | URL, init?: RequestInit) =>
    once(input, init, MAX_REDIRECTS)) as typeof fetch;
}
