import { NextRequest, NextResponse } from "next/server";
import { hasRuntimeEnvValue, setRuntimeEnvValue } from "@/lib/runtime-env";

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

export async function GET() {
  return NextResponse.json({
    configured: hasRuntimeEnvValue("NVIDIA_API_KEY"),
  });
}

export async function POST(request: NextRequest) {
  if (!canWriteRuntimeConfig(request)) {
    return NextResponse.json(
      { error: "Runtime key storage is only enabled from the local HUD host." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key.trim() : "";

  if (!key) {
    return NextResponse.json({ error: "NVIDIA API key is required." }, { status: 400 });
  }

  if (!key.startsWith("nvapi-")) {
    return NextResponse.json({ error: "NVIDIA API key should start with nvapi-." }, { status: 400 });
  }

  setRuntimeEnvValue("NVIDIA_API_KEY", key);

  return NextResponse.json({
    configured: true,
  });
}
