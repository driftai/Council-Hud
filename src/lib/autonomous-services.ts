import "server-only";

import { spawn } from "node:child_process";

import { loadCouncilConfig } from "@/lib/council-config";

// Inspect systemd-managed autonomous workers running inside WSL. Each entry surfaces a
// service unit's headline state — active/inactive, sub-state, since-when, main PID,
// memory usage — so the HUD can show "what's running for me right now" without exposing
// the underlying systemctl output (which leaks usernames in paths).
//
// All `systemctl show` runs happen inside WSL via the same wsl.exe spawn pattern the
// smart-fallback engine uses. Failures yield "unreachable" entries — never crash.

export type ServiceStatus = {
  unit: string;
  scope: "system" | "user";
  description: string;
  active: "active" | "inactive" | "failed" | "activating" | "deactivating" | "unknown";
  sub: string;
  since: number; // epoch ms; 0 if unknown
  pid: number;
  memoryBytes: number;
  category: "gateway" | "router" | "tunnel" | "sentinel" | "other";
};

export type ServicesSnapshot = {
  available: boolean;
  services: ServiceStatus[];
  generatedAt: number;
};

const TARGETED_UNITS: Array<{ unit: string; scope: "system" | "user"; category: ServiceStatus["category"] }> = [
  { unit: "openclaw-gateway",       scope: "user",   category: "gateway"  },
  { unit: "meru-router",            scope: "system", category: "router"   },
  { unit: "hermes-model-router",    scope: "user",   category: "router"   },
  { unit: "cloudflared-tunnel",     scope: "user",   category: "tunnel"   },
  { unit: "config-sentinel",        scope: "user",   category: "sentinel" },
];

function runWslSystemctl(scope: "system" | "user", args: string[], timeoutMs = 6000): Promise<string | null> {
  return new Promise((resolve) => {
    const cfg = loadCouncilConfig();
    const wslArgs = ["-d", cfg.wsl.distro, "-u", cfg.wsl.user, "--", "systemctl"];
    if (scope === "user") wslArgs.push("--user");
    wslArgs.push(...args);

    const child = spawn("wsl.exe", wslArgs, { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { out += chunk.toString(); });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out.trim() || null);
    });
  });
}

function parseShowOutput(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function normalizeActive(state: string): ServiceStatus["active"] {
  const known = ["active", "inactive", "failed", "activating", "deactivating"];
  return known.includes(state) ? (state as ServiceStatus["active"]) : "unknown";
}

export async function getServicesSnapshot(): Promise<ServicesSnapshot> {
  const results: ServiceStatus[] = [];

  const lookups = TARGETED_UNITS.map(async (target) => {
    const raw = await runWslSystemctl(target.scope, [
      "show", target.unit,
      "--property=Description",
      "--property=ActiveState",
      "--property=SubState",
      "--property=ActiveEnterTimestamp",
      "--property=MainPID",
      "--property=MemoryCurrent",
    ]);
    if (!raw) return null;
    const props = parseShowOutput(raw);
    // systemd returns "[not-set]" sentinel values when a unit has never run; we surface
    // those as 0/unknown so the HUD can show them as "inactive" without confusion.
    const sinceRaw = props.ActiveEnterTimestamp || "";
    const since = sinceRaw && sinceRaw !== "n/a" ? Date.parse(sinceRaw) : 0;
    const memoryRaw = Number(props.MemoryCurrent || 0);
    const memoryBytes = Number.isFinite(memoryRaw) && memoryRaw > 0 && memoryRaw < 1e15 ? memoryRaw : 0;
    return {
      unit: target.unit,
      scope: target.scope,
      description: props.Description || target.unit,
      active: normalizeActive(props.ActiveState || ""),
      sub: props.SubState || "",
      since: Number.isFinite(since) ? since : 0,
      pid: Number(props.MainPID || 0),
      memoryBytes,
      category: target.category,
    } as ServiceStatus;
  });

  const settled = await Promise.all(lookups);
  for (const s of settled) {
    if (s) results.push(s);
  }
  // Sort: active first, then by scope, then by name.
  results.sort((a, b) => {
    const av = a.active === "active" ? 0 : 1;
    const bv = b.active === "active" ? 0 : 1;
    if (av !== bv) return av - bv;
    return a.unit.localeCompare(b.unit);
  });

  return {
    available: results.length > 0,
    services: results,
    generatedAt: Date.now(),
  };
}
