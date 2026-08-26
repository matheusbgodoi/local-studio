import { NextRequest, NextResponse } from "next/server";
import {
  applySettingsUpdate,
  getApiSettings,
  InvalidSettingsError,
  settingsView,
  type ApiSettingsUpdate,
} from "@local-studio/agent-runtime/settings-service";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(settingsView(await getApiSettings()));
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load settings", details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    const update = (await request.json()) as ApiSettingsUpdate;
    const saved = await applySettingsUpdate(update);
    return NextResponse.json({ success: true, ...settingsView(saved) });
  } catch (error) {
    if (error instanceof InvalidSettingsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to save settings", details: String(error) },
      { status: 500 },
    );
  }
}
