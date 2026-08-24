//
// In-process egress, which the jail cannot reach.
//
// Most things the agent does are separate processes, and a separate process can
// be put inside a Seatbelt jail. Two things are not: the reader and the search
// client run inside the agent-runtime process itself, using node:http and
// node:https directly. That process cannot be jailed — it has to keep talking to
// the local controller and to a model backend that may live on Tailscale, and a
// jail that permitted those would be permitting most of the machine.
//
// So this path is routed in code rather than confined by the kernel, and the
// difference is stated plainly in the status contract's `unconfinedPaths`
// instead of being quietly rounded up to "protected". What makes it honest
// rather than decorative is that it is fail-closed the same way: when
// protection is demanded, these requests go through the tunnel or they do not
// go at all. There is no branch here that falls back to a direct socket.
//
// An HTTP CONNECT tunnel is used rather than a global dispatcher because the
// runtime's own traffic must NOT be rerouted: pointing undici's global
// dispatcher at the VPN would drag model inference and controller calls through
// it too, which is both wrong and a good way to make the product look broken.
//

import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { Agent as HttpAgent, type AgentOptions } from "node:http";
import { Agent as HttpsAgent } from "node:https";

type ConnectionOptions = { host?: string; port?: number; servername?: string };

function openTunnel(
  proxyHost: string,
  proxyPort: number,
  host: string,
  port: number,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: proxyHost, port: proxyPort });
    let raw = "";
    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    const onData = (chunk: Buffer): void => {
      raw += chunk.toString("utf8");
      const end = raw.indexOf("\r\n\r\n");
      if (end < 0) return;
      socket.removeListener("data", onData);
      if (!/^HTTP\/1\.[01] 200/.test(raw)) {
        //
        // The tunnel refused. That is the fail-closed answer and it is returned
        // as an error, never as a signal to try the destination directly.
        //
        return fail(new Error("the protected tunnel refused the connection"));
      }
      socket.removeListener("error", fail);
      resolve(socket);
    };
    socket.on("data", onData);
  });
}

function parseEndpoint(endpoint: string): { host: string; port: number } {
  const [host, port] = endpoint.split(":");
  return { host: host || "127.0.0.1", port: Number(port) || 0 };
}

//
// The agents are keyed by endpoint and reused, because a new Agent per request
// would open a new tunnel per request and defeat keep-alive against the proxy.
//
const cache = new Map<string, { http: HttpAgent; https: HttpsAgent }>();

//
// Whether replacing `createConnection` on an Agent actually diverts the socket.
//
// It does under node, which is how the runtime ships (`node dist/server.js`) —
// measured: the override runs, the CONNECT goes to the tunnel, the response
// comes back 200. It does NOT under Bun, which `bun --watch src/server.ts` uses
// for development: the same code returns 200 having never called the override,
// i.e. straight out of the machine's own route.
//
// So this is checked rather than assumed, and a caller that cannot be routed
// refuses instead of quietly leaking. Getting this wrong would be invisible —
// the request succeeds either way, and only the exit address differs.
//
export function inProcessRoutingSupported(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun === "undefined";
}

export function proxyAgents(endpoint: string): { http: HttpAgent; https: HttpsAgent } {
  const existing = cache.get(endpoint);
  if (existing) return existing;

  const proxy = parseEndpoint(endpoint);
  const options: AgentOptions = { keepAlive: true, maxSockets: 8 };

  //
  // createConnection is replaced on the instance rather than by subclassing:
  // node types it with a Duplex return AND an optional callback, and the two
  // shapes do not line up in an override. The contract that matters is the
  // runtime one — hand the socket to the callback — and it is identical.
  //
  const tunnelled = <T extends HttpAgent | HttpsAgent>(agent: T, secure: boolean): T => {
    const connectVia = (
      connectionOptions: ConnectionOptions,
      callback: (error: Error | null, socket?: Socket) => void,
    ): void => {
      const host = connectionOptions.host ?? "";
      const port = connectionOptions.port ?? (secure ? 443 : 80);
      openTunnel(proxy.host, proxy.port, host, port)
        .then((socket) => {
          //
          // TLS is negotiated end-to-end on top of the tunnel, with servername
          // taken from the requested host, so the proxy carries bytes it cannot
          // read and certificate validation still checks the real destination.
          //
          callback(
            null,
            secure
              ? (tlsConnect({ socket, servername: connectionOptions.servername ?? host }) as Socket)
              : socket,
          );
        })
        .catch((error: unknown) => {
          callback(error instanceof Error ? error : new Error("the protected tunnel failed"));
        });
    };
    (agent as unknown as { createConnection: typeof connectVia }).createConnection = connectVia;
    return agent;
  };

  const agents = {
    http: tunnelled(new HttpAgent(options), false),
    https: tunnelled(new HttpsAgent(options), true),
  };
  cache.set(endpoint, agents);
  return agents;
}
