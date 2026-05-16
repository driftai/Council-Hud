import { NextRequest, NextResponse } from "next/server";
import { getAuditSnapshot } from "@/lib/audit-trail";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json({ ok: false, error: "Audit Trail view is local-only." }, { status: 403 });
  }
  try {
    const snapshot = await getAuditSnapshot();
    return NextResponse.json({ ok: true, snapshot });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Audit Trail snapshot failed." }, { status: 502 });
  }
}
