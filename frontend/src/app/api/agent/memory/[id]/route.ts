import { NextRequest } from "next/server";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  return denied ?? proxyToAgentRuntime(request);
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  return denied ?? proxyToAgentRuntime(request);
}
