import { NextRequest, NextResponse } from "next/server";
import { sendCouncilMessage } from "@/lib/council-ipc";
import { canUseLocalCouncilApi } from "@/lib/local-api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS = new Set(["chat", "task", "status", "presence", "ack", "heartbeat", "error"]);
const VALID_SCOPES = new Set(["topic", "dm", "broadcast"]);

function cleanName(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.-]{1,40}$/.test(text) ? text : fallback;
}

function cleanTopic(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim().replace(/^#/, "") : "";
  return /^[A-Za-z0-9_.-]{1,40}$/.test(text) ? text : fallback;
}

export async function POST(request: NextRequest) {
  if (!canUseLocalCouncilApi(request)) {
    return NextResponse.json(
      { ok: false, error: "Council IPC send is local-only unless COUNCIL_HUD_ALLOW_PUBLIC=1." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ ok: false, error: "Message content is required." }, { status: 400 });
  }
  if (content.length > 4000) {
    return NextResponse.json({ ok: false, error: "Council message is too long." }, { status: 400 });
  }

  const from = cleanName(body?.from, "operator");
  const scope = VALID_SCOPES.has(String(body?.scope || "")) ? String(body.scope) : "topic";
  const to = scope === "dm" ? cleanName(body?.to, "agent-e-bridge") : "*";
  // The IPC hub fans out by topic — even broadcasts must carry one or they get silently dropped.
  // DMs ride on a private channel (no topic).
  const topic = scope === "dm" ? null : cleanTopic(body?.topic, "council");
  const kind = VALID_KINDS.has(String(body?.kind || "")) ? String(body.kind) : "chat";

  try {
    const result = await sendCouncilMessage({ content, from, to, topic, kind });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Council send bridge failed." },
      { status: 502 }
    );
  }
}
