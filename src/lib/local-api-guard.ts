import { NextRequest } from "next/server";

function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost"
    || host === "127.0.0.1"
    || host === "::1"
    || host.endsWith(".localhost")
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
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

export function canUseLocalCouncilApi(request: NextRequest) {
  if (process.env.COUNCIL_HUD_ALLOW_PUBLIC === "1") return true;
  return isSameOrigin(request) && isLocalHost(request.nextUrl.hostname);
}
