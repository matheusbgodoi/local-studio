import { SUBAGENT_BODY_LIMIT_BYTES, SUBAGENT_RESPONSE_TIMEOUT_MS } from "@shared/agent/subagent";
import { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  return proxyToAgentRuntime(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  return proxyToAgentRuntime(request, {
    bodyLimitBytes: SUBAGENT_BODY_LIMIT_BYTES,
    responseTimeoutMs: SUBAGENT_RESPONSE_TIMEOUT_MS,
  });
}
