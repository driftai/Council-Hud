import { NextRequest, NextResponse } from "next/server";
import { publicCouncilIdentity } from "@/lib/council-config";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Exposes only the identity surface of council.config (default sender + DM target + agent
// modes). No filesystem paths, no usernames, no token bytes. Used by client components to
// derive default values + sender-mode coloring without hardcoding agent names.
export async function GET(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json(
      { ok: false, error: "Council identity is local-only." },
      { status: 403 }
    );
  }
  return NextResponse.json({ ok: true, identity: publicCouncilIdentity() });
}
