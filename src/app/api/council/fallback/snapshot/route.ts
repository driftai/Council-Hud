import { NextRequest, NextResponse } from "next/server";
import { getEngineSnapshot, getAgentPicks } from "@/lib/smart-fallback";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json(
      { ok: false, error: "Smart Fallback controls are local-only." },
      { status: 403 }
    );
  }

  try {
    // Run snapshot + picks in parallel — picks call the engine N times, snapshot reads a file.
    const [snapshot, picks] = await Promise.all([
      getEngineSnapshot(),
      getAgentPicks(),
    ]);
    return NextResponse.json({ ok: true, snapshot, picks });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Smart Fallback snapshot failed." },
      { status: 502 }
    );
  }
}
