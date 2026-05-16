import { NextRequest, NextResponse } from "next/server";
import { getServicesSnapshot } from "@/lib/autonomous-services";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json({ ok: false, error: "Services view is local-only." }, { status: 403 });
  }
  try {
    const snapshot = await getServicesSnapshot();
    return NextResponse.json({ ok: true, snapshot });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Services snapshot failed." }, { status: 502 });
  }
}
