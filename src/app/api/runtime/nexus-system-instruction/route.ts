import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_NEXUS_SYSTEM_INSTRUCTION,
  NEXUS_SYSTEM_INSTRUCTION_KEY,
} from "@/lib/nexus-system-instruction";
import { getRuntimeTextValue, setRuntimeTextValue } from "@/lib/runtime-env";

export const runtime = "nodejs";

function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost"
    || host === "127.0.0.1"
    || host === "::1"
    || host.endsWith(".localhost")
    || /^192\.168\./.test(host)
    || /^10\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function canWriteRuntimeConfig(request: NextRequest) {
  if (process.env.NEXUS_ALLOW_PUBLIC_RUNTIME_CONFIG === "1") return true;
  return isSameOrigin(request) && isLocalHost(request.nextUrl.hostname);
}

function getActiveInstruction() {
  return getRuntimeTextValue(NEXUS_SYSTEM_INSTRUCTION_KEY) || DEFAULT_NEXUS_SYSTEM_INSTRUCTION;
}

export async function GET() {
  const instruction = getActiveInstruction();
  return NextResponse.json({
    instruction,
    defaultInstruction: DEFAULT_NEXUS_SYSTEM_INSTRUCTION,
    customized: instruction !== DEFAULT_NEXUS_SYSTEM_INSTRUCTION,
    storageKey: `${NEXUS_SYSTEM_INSTRUCTION_KEY}_B64`,
  });
}

export async function POST(request: NextRequest) {
  if (!canWriteRuntimeConfig(request)) {
    return NextResponse.json(
      { error: "Runtime instruction storage is only enabled from the local HUD host." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const reset = Boolean(body?.reset);
  const instruction = reset
    ? DEFAULT_NEXUS_SYSTEM_INSTRUCTION
    : typeof body?.instruction === "string"
      ? body.instruction.trim()
      : "";

  if (!instruction) {
    return NextResponse.json({ error: "System instruction is required." }, { status: 400 });
  }

  if (instruction.length > 12000) {
    return NextResponse.json({ error: "System instruction is too large. Keep it under 12,000 characters." }, { status: 400 });
  }

  setRuntimeTextValue(NEXUS_SYSTEM_INSTRUCTION_KEY, instruction);

  return NextResponse.json({
    instruction,
    customized: instruction !== DEFAULT_NEXUS_SYSTEM_INSTRUCTION,
    storageKey: `${NEXUS_SYSTEM_INSTRUCTION_KEY}_B64`,
  });
}
