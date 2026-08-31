import { NextRequest, NextResponse } from "next/server";
import { UPSTREAM_TIMEOUT_HEADER } from "@/lib/api/http-error-message";
import { markUpstreamDown, markUpstreamUp, upstreamKey, upstreamVerdict } from "./upstream-breaker";
import { getClientInfo, logProxyAccess, shouldLogProxyError } from "./proxy-logging";
import {
  buildFallbackTargetUrl,
  buildProxyRequestHeaders,
  buildTargetUrl,
  fetchWithOptionalFallback,
  getForwardedSearchParams,
  isAbortError,
  isUpstreamUnreachableError,
  ProxyBodyTooLargeError,
  proxyRequestBodyLimit,
  readProxyRequestBody,
} from "./proxy-fetch";
import { toProxyNextResponse } from "./proxy-response";
import { resolveProxyTarget } from "./proxy-target";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "GET", path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "POST", path);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "PUT", path);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "DELETE", path);
}

function upstreamTimeoutResponse(): NextResponse {
  //
  // A 504 from here is not a transient server fault. It is this proxy stating
  // that the controller did not answer within the budget, and for a host that
  // is powered off that is the steady state, not a blip — so the header tells
  // the client not to spend the retry ladder rediscovering it.
  //
  return NextResponse.json(
    { error: "Backend request timed out" },
    { status: 504, headers: { [UPSTREAM_TIMEOUT_HEADER]: "1" } },
  );
}

async function handleRequest(request: NextRequest, method: string, path: string[]) {
  const startTime = Date.now();
  const client = getClientInfo(request);
  let breakerKey: string | null = null;

  try {
    const target = await resolveProxyTarget(request, client);
    if ("blockedResponse" in target) return target.blockedResponse;

    // Never forward credentials to the controller as query params.
    const { apiKeyQuery, searchParams } = getForwardedSearchParams(request);
    const targetUrl = buildTargetUrl(target.backendUrl, path, searchParams);
    const fallbackTargetUrl = buildFallbackTargetUrl({
      defaultBackendUrl: target.defaultBackendUrl,
      overrideUrl: target.overrideUrl,
      path,
      searchParams,
    });
    const hasAuth = Boolean(request.headers.get("authorization"));
    logProxyAccess({ client, hasAuth, method, overrideUrl: target.overrideUrl, path });

    // A controller already known to be silent is answered from memory rather
    // than by holding this request — and the socket it occupies — open for the
    // whole upstream budget.
    // The wake path is exempt: `launch/*` and `wait-ready` are how the owner
    // asks a sleeping host to come back, and a breaker latched by that very
    // sleep must not be what refuses them.
    if (path[0] !== "launch" && path.join("/") !== "wait-ready") {
      breakerKey = upstreamKey(targetUrl);
      if (upstreamVerdict(breakerKey) === "open") return upstreamTimeoutResponse();
    }

    const body = await readProxyRequestBody(request, method, proxyRequestBodyLimit(path));
    const headers = buildProxyRequestHeaders(
      request,
      target.apiKey,
      apiKeyQuery,
      Boolean(target.overrideUrl),
    );

    const { response, usedFallback } = await fetchWithOptionalFallback(
      targetUrl,
      fallbackTargetUrl,
      { method, headers, body },
      {
        client,
        method,
        path,
        overrideUsed: Boolean(target.overrideUrl),
        strictOverride: target.strictOverride,
      },
    );

    // It answered at all, so it is awake. Reopen immediately — waking the host
    // must not require waiting out a cooldown.
    if (breakerKey) markUpstreamUp(breakerKey);

    return toProxyNextResponse(response, {
      client,
      invalidateOverride: usedFallback || target.blockedOverrideCleared,
      method,
      path,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    if (shouldLogProxyError(method, path, error)) {
      console.error(
        `[PROXY ERROR] ip=${client.ip} | country=${client.country} | method=${method} | path=/${path.join("/")} | duration=${duration}ms | error=${String(error)}`,
      );
    }
    // Both say the same thing: the controller did not answer. One is our own
    // deadline, the other is the connection never coming up — and undici's 10s
    // connect timeout means the second arrives first on any route budgeted
    // above ten seconds.
    if (isAbortError(error) || isUpstreamUnreachableError(error)) {
      if (breakerKey) markUpstreamDown(breakerKey);
      return upstreamTimeoutResponse();
    }
    if (error instanceof ProxyBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
