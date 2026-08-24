import { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return proxyToAgentRuntime(request);
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return proxyToAgentRuntime(request, { bodyLimitBytes: 64 * 1024 });
}

//
// The only destructive route in this file, so it self-checks rather than
// relying on the middleware alone — the same defence-in-depth the guard module
// describes for the crown-jewel routes. GET and PATCH are read/flag operations
// and keep the file's existing shape.
//
export async function DELETE(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  return proxyToAgentRuntime(request);
}
