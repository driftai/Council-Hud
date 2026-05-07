import { NextRequest, NextResponse } from "next/server";
import { fetchCouncilHealth } from "@/lib/council-ipc";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json(
      { ok: false, sessions: [], error: "Council IPC HUD is local-only unless COUNCIL_HUD_ALLOW_PUBLIC=1." },
      { status: 403 }
    );
  }

  try {
    return NextResponse.json(await fetchCouncilHealth());
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, sessions: [], error: error?.message || "Council status bridge failed." },
      { status: 502 }
    );
  }
}
