import { NextRequest, NextResponse } from "next/server";
import { reprobeBlockedModels } from "@/lib/smart-fallback";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sweeps the engine's blocked-models list, resets each circuit, and runs the probe
// script (which now auto-loads ~/.hermes/.env so credentials match the canonical
// store hermes/openclaw use). Returns pass/fail counts so the HUD can render a toast.
//
// Long-running: each per-model probe can take up to 40s; with the default cap of 40
// models this can run well past the platform's default fetch timeout. Callers should
// treat the response as best-effort and re-poll the snapshot endpoint after.
export async function POST(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json(
      { ok: false, error: "Smart Fallback controls are local-only." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const kinds = Array.isArray(body?.kinds) ? body.kinds.filter((k: any) => typeof k === "string") : undefined;
  const max = typeof body?.max === "number" && body.max > 0 && body.max <= 100 ? body.max : undefined;

  try {
    const result = await reprobeBlockedModels({ kinds, max });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Reprobe failed." },
      { status: 502 }
    );
  }
}
