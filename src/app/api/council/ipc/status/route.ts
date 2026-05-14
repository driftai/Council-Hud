import { NextRequest, NextResponse } from "next/server";
import { getIpcStackStatus } from "@/lib/council-ipc";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json(
      { ok: false, error: "Council IPC controls are local-only." },
      { status: 403 }
    );
  }

  try {
    const status = await getIpcStackStatus();
    return NextResponse.json({ ok: true, status });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "IPC status probe failed." },
      { status: 502 }
    );
  }
}
