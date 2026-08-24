import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { protectedEnvironment, protectedFetch, protectedSpawn } from "./network";
import { assertNoInheritedDescriptors, PROTECTED_STDIO } from "./network/jail";

export type McpToolAnnotations = ToolAnnotations;
export type McpToolInfo = Tool;

export interface McpConnection {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

export interface StdioTarget {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpTarget {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
  authorize?: (forceRefresh: boolean) => Promise<Record<string, string>>;
  signal?: AbortSignal;
}

export type McpTarget = StdioTarget | HttpTarget;

const CLIENT_INFO = { name: "local-studio", version: "2.0.0" };

const processEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

const combinedSignal = (
  requestSignal: AbortSignal | null | undefined,
  targetSignal: AbortSignal | undefined,
): AbortSignal | undefined => {
  if (requestSignal && targetSignal) return AbortSignal.any([requestSignal, targetSignal]);
  return requestSignal ?? targetSignal ?? undefined;
};

const authorizedFetch = (target: HttpTarget): typeof fetch =>
  async (input, init) => {
    //
    // Resolved per call, not captured once: protection can be engaged or
    // released while a connector is pooled, and the transport outlives either
    // transition. Resolving here means the next request follows the policy in
    // force now, and throws rather than going direct if it cannot.
    //
    const send = async (forceRefresh: boolean): Promise<Response> => {
      const routed = protectedFetch(`the remote MCP connector at ${new URL(target.url).host}`);
      const headers = new Headers(init?.headers);
      const authorization = target.authorize ? await target.authorize(forceRefresh) : {};
      for (const [name, value] of Object.entries(authorization)) headers.set(name, value);
      return routed(input, {
        ...init,
        headers,
        redirect: target.authorize ? "error" : "follow",
        signal: combinedSignal(init?.signal, target.signal),
      });
    };
    const response = await send(false);
    return response.status === 401 && target.authorize ? send(true) : response;
  };

const transportFor = (target: McpTarget) => {
  if (target.transport === "stdio") {
    //
    // A local MCP server is an arbitrary program the owner installed, and it
    // opens whatever sockets it likes. It runs on the session's behalf, so it
    // goes inside the same boundary as everything else the agent starts —
    // otherwise "protected" would mean protected except for connectors.
    //
    const jailed = protectedSpawn(target.command, target.args ?? []);
    //
    // `stderr: "pipe"` below is not a logging preference, it is the boundary.
    // The SDK defaults that slot to "inherit", which hands the child the
    // runtime's own fd 2 — measured, a connector given that inherited a live
    // TCP socket and wrote through it from inside the jail while its own
    // connect() returned EPERM. Asserted here so a future edit that "tidies"
    // the option away fails loudly instead of quietly reopening it.
    //
    assertNoInheritedDescriptors(PROTECTED_STDIO);
    return new StdioClientTransport({
      command: jailed.command,
      args: jailed.args,
      env: { ...processEnvironment(), ...protectedEnvironment(), ...(target.env ?? {}) },
      ...(target.cwd ? { cwd: target.cwd } : {}),
      stderr: "pipe",
    });
  }
  //
  // Routed rather than refused. A remote MCP server is reached with a fetch, and
  // the global one takes no agent — so this hands the transport a fetch built on
  // node:https whose only socket factory is the CONNECT tunnel. Measured against
  // the real Gmail and Calendar endpoints: the full StreamableHTTP lifecycle,
  // SSE included, crosses the tunnel, and with the tunnel killed it throws
  // instead of finding another way out.
  //
  return new StreamableHTTPClientTransport(new URL(target.url), {
    requestInit: { headers: target.headers ?? {} },
    fetch: authorizedFetch(target),
  });
};

class SdkMcpConnection implements McpConnection {
  private readonly client = new Client(CLIENT_INFO, { capabilities: {} });
  private readonly connected: Promise<void>;
  private readonly signal: AbortSignal | undefined;

  constructor(target: McpTarget) {
    this.signal = target.transport === "http" ? target.signal : undefined;
    this.connected = this.client.connect(transportFor(target), { signal: this.signal });
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.connected;
    const result = await this.client.listTools({}, { signal: this.signal });
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.connected;
    return this.client.callTool(
      { name, arguments: args },
      undefined,
      { signal: this.signal },
    );
  }

  close(): void {
    void this.client.close().catch(() => undefined);
  }
}

export const connectMcp = (target: McpTarget): McpConnection => new SdkMcpConnection(target);
