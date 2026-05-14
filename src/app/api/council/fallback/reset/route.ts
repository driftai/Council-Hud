import { NextRequest, NextResponse } from "next/server";
import { resetModelCircuit } from "@/lib/smart-fallback";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json(
      { ok: false, error: "Smart Fallback controls are local-only." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const modelId = typeof body?.modelId === "string" ? body.modelId.trim() : "";
  if (!modelId) {
    return NextResponse.json({ ok: false, error: "modelId is required." }, { status: 400 });
  }
  // Pre-validate the format so we return 400 (not 502) for client-side mistakes — same regex
  // the helper uses internally.
  if (!/^[\w./:@+-]{1,120}$/.test(modelId)) {
    return NextResponse.json({ ok: false, error: "invalid model id" }, { status: 400 });
  }

  try {
    const result = await resetModelCircuit(modelId);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Reset failed." },
      { status: 502 }
    );
  }
}
