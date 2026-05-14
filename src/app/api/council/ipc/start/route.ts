import { NextRequest, NextResponse } from "next/server";
import { startIpcStack } from "@/lib/council-ipc";
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
    const result = await startIpcStack();
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "IPC stack start failed." },
      { status: 502 }
    );
  }
}
