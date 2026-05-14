import { NextRequest, NextResponse } from "next/server";
import { stopIpcStack } from "@/lib/council-ipc";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json(
      { ok: false, error: "Council IPC controls are local-only." },
      { status: 403 }
    );
  }

  try {
    const result = await stopIpcStack();
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "IPC stack stop failed." },
      { status: 502 }
    );
  }
}
