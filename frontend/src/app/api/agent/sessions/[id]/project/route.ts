import { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

//
// Moving a conversation relocates its transcript on disk, so it self-checks the
// same way DELETE next door does rather than relying on the middleware alone.
//
export async function POST(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  return proxyToAgentRuntime(request, { bodyLimitBytes: 8 * 1024 });
}
