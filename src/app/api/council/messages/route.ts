import { NextRequest, NextResponse } from "next/server";
import { readCouncilMessages } from "@/lib/council-ipc";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json(
      { messages: [], error: "Council IPC HUD is local-only unless COUNCIL_HUD_ALLOW_PUBLIC=1." },
      { status: 403 }
    );
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") || 80);
  const result = await readCouncilMessages(Number.isFinite(limit) ? limit : 80);
  return NextResponse.json(result, { status: result.error ? 206 : 200 });
}
