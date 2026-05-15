import { NextRequest, NextResponse } from "next/server";
import { scanSkillNexus } from "@/lib/skill-nexus";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json(
      { ok: false, error: "Skill Nexus is local-only." },
      { status: 403 }
    );
  }
  try {
    const report = await scanSkillNexus();
    return NextResponse.json(report);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Skill Nexus scan failed." },
      { status: 502 }
    );
  }
}
