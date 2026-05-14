import "server-only";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

// Smart Fallback v5 bridge — consult ~/.openclaw/workspace/smart-fallback-v5/engine.py
// (inside WSL) to find out whether a model is currently routable, pick a replacement when it
// isn't, and feed call outcomes back so the engine's view of HUD-side traffic stays current.
//
// Every call is best-effort: if WSL or the engine isn't reachable, the helpers return null and
// the caller falls back to whatever model the user selected. We never block a chat turn on the
// engine being available.

const WSL_DISTRO = process.env.COUNCIL_WSL_DISTRO || "Ubuntu";
const WSL_USER = process.env.COUNCIL_WSL_USER || "linux-user";
const ENGINE_PATH = process.env.COUNCIL_FALLBACK_ENGINE
  || "/home/linux-user/.openclaw/workspace/smart-fallback-v5/engine.py";
const FALLBACK_AGENT = process.env.COUNCIL_FALLBACK_AGENT || "agent-e";
const HEALTH_FILE = process.env.COUNCIL_FALLBACK_HEALTH
  || "\\\\wsl.localhost\\Ubuntu\\home\\linux-user\\.openclaw\\workspace\\data\\smart-fallback-v5\\model-health.json";
const KNOWN_AGENTS = (process.env.COUNCIL_FALLBACK_AGENTS || "eve,prime,echo,vesper,meru")
  .split(",").map((value) => value.trim()).filter(Boolean);

// We don't want a spawn-per-NVIDIA-call. Cache routability + fallback picks for ~30s. After that
// we re-check so newly-recovered models become reachable again on their own.
const CHECK_CACHE_MS = 30_000;
const PICK_CACHE_MS = 30_000;
const CALL_TIMEOUT_MS = 4_000;

export type RoutabilityInfo = {
  model_id: string;
  try: boolean;
  circuit_state: string;
  cooldown_class: string;
  cooldown_remaining: number;
  score: number;
};

export type FallbackPick = {
  eligible: boolean;
  model_id: string;
  capabilities?: string[];
  best_provider?: { name: string; api_key_env?: string };
  circuit_state?: string;
};

const checkCache = new Map<string, { value: RoutabilityInfo | null; expires: number }>();
const pickCache = new Map<string, { value: FallbackPick | null; expires: number }>();
// Engine availability — once we've confirmed it's unreachable we stop spawning for a minute.
let engineUnavailableUntil = 0;

function isEngineSilenced() {
  return Date.now() < engineUnavailableUntil;
}

function silenceEngine(reason: string) {
  engineUnavailableUntil = Date.now() + 60_000;
  if (process.env.COUNCIL_FALLBACK_DEBUG === "1") {
    console.info("[smart-fallback] engine silenced:", reason);
  }
}

function runEngine(args: string[], timeoutMs = CALL_TIMEOUT_MS): Promise<string | null> {
  if (isEngineSilenced()) return Promise.resolve(null);
  return new Promise<string | null>((resolve) => {
    let resolved = false;
    const finish = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const child = spawn(
      "wsl.exe",
      ["-d", WSL_DISTRO, "-u", WSL_USER, "--", "python3", ENGINE_PATH, ...args],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill();
      silenceEngine(`timeout running ${args.join(" ")}`);
      finish(null);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      silenceEngine(`spawn error: ${error.message}`);
      finish(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        if (process.env.COUNCIL_FALLBACK_DEBUG === "1") {
          console.info(`[smart-fallback] engine exit=${code} args=${args.join(" ")} stderr=${stderr.slice(0, 200)}`);
        }
        finish(null);
        return;
      }
      finish(stdout.trim() || null);
    });
  });
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function checkModelRoutable(modelId: string): Promise<RoutabilityInfo | null> {
  if (!modelId) return null;
  const now = Date.now();
  const cached = checkCache.get(modelId);
  if (cached && cached.expires > now) return cached.value;

  const raw = await runEngine(["check", modelId]);
  const value = parseJson<RoutabilityInfo>(raw);
  checkCache.set(modelId, { value, expires: now + CHECK_CACHE_MS });
  return value;
}

export async function pickFallbackModel(agent = FALLBACK_AGENT): Promise<FallbackPick | null> {
  const now = Date.now();
  const cached = pickCache.get(agent);
  if (cached && cached.expires > now) return cached.value;

  const raw = await runEngine(["pick", agent]);
  const parsed = parseJson<FallbackPick>(raw);
  const value = parsed && parsed.eligible && parsed.model_id ? parsed : null;
  pickCache.set(agent, { value, expires: now + PICK_CACHE_MS });
  return value;
}

export type OutcomeKind = "success" | "rate_limit" | "timeout" | "error";

export function recordModelOutcome(modelId: string, kind: OutcomeKind, value?: number | string): void {
  if (!modelId || isEngineSilenced()) return;
  // After we report a failure or success the cached routability is stale — wipe so the next
  // call sees the engine's freshly-updated view.
  checkCache.delete(modelId);
  const args = kind === "success"
    ? ["record", modelId, "success", String(typeof value === "number" ? Math.round(value) : value ?? 0)]
    : ["record", modelId, "failure", String(value ?? kind)];
  // Fire-and-forget so the chat response isn't blocked by this side-channel write.
  void runEngine(args, 3000);
}

export async function resolveRoutableModel(preferredModelId: string, agent = FALLBACK_AGENT): Promise<{
  model: string;
  source: "preferred" | "fallback" | "preferred-engine-silenced";
  routability?: RoutabilityInfo | null;
  fallback?: FallbackPick | null;
}> {
  const routability = await checkModelRoutable(preferredModelId);
  if (!routability) {
    return { model: preferredModelId, source: "preferred-engine-silenced", routability: null };
  }
  if (routability.try) {
    return { model: preferredModelId, source: "preferred", routability };
  }
  const fallback = await pickFallbackModel(agent);
  if (fallback?.model_id && fallback.model_id !== preferredModelId) {
    return { model: fallback.model_id, source: "fallback", routability, fallback };
  }
  // No fallback available — return the preferred anyway. Better to attempt than to fail outright.
  return { model: preferredModelId, source: "preferred", routability };
}

// === Engine inspection surface for the HUD ============================
// Read-only snapshots derived from model-health.json + small CLI calls. None of these touch
// credentials — only state tags, scores, cooldowns, and chosen model IDs. Designed to be
// rendered in a dashboard card without exposing paths or tokens.

export type ModelEntry = {
  model_id: string;
  circuit_state: "closed" | "open" | "half_open" | "unknown";
  cooldown_class: string;
  cooldown_remaining: number;
  score: number;
  consecutive_failures: number;
  total_calls: number;
  total_successes: number;
  total_rate_limits: number;
  total_quota_exhaustions: number;
  total_timeouts: number;
  success_rate: number;
  avg_latency_ms: number;
  last_success_at: number;
  last_failure_at: number;
  last_error: string;
};

export type EngineSnapshot = {
  engineAvailable: boolean;
  totalModels: number;
  healthy: number;
  recovering: number;
  blocked: number;
  models: ModelEntry[];
  generatedAt: number;
  source: string;
};

export async function getEngineSnapshot(): Promise<EngineSnapshot> {
  const fallback: EngineSnapshot = {
    engineAvailable: false,
    totalModels: 0,
    healthy: 0,
    recovering: 0,
    blocked: 0,
    models: [],
    generatedAt: Date.now(),
    source: "unavailable",
  };

  let raw: string;
  try {
    raw = await fs.readFile(HEALTH_FILE, "utf8");
  } catch {
    return fallback;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  const health = parsed?.health && typeof parsed.health === "object" ? parsed.health : {};
  const now = Date.now() / 1000;
  const entries: ModelEntry[] = [];

  for (const [modelId, info] of Object.entries<any>(health)) {
    if (!info || typeof info !== "object") continue;
    const circuit = info.circuit && typeof info.circuit === "object" ? info.circuit : {};
    const cooldownUntil = Number(circuit.cooldown_until || 0);
    const cooldownRemaining = cooldownUntil > now ? cooldownUntil - now : 0;
    const stateRaw = String(circuit.state || "unknown");
    const state = stateRaw === "closed" || stateRaw === "open" || stateRaw === "half_open"
      ? stateRaw as ModelEntry["circuit_state"]
      : "unknown";
    entries.push({
      model_id: modelId,
      circuit_state: state,
      cooldown_class: String(circuit.cooldown_class || "occasional"),
      cooldown_remaining: Math.round(cooldownRemaining),
      score: Number(info.score ?? 0),
      consecutive_failures: Number(info.consecutive_failures ?? 0),
      total_calls: Number(info.total_calls ?? 0),
      total_successes: Number(info.total_successes ?? 0),
      total_rate_limits: Number(info.total_rate_limits ?? 0),
      total_quota_exhaustions: Number(info.total_quota_exhaustions ?? 0),
      total_timeouts: Number(info.total_timeouts ?? 0),
      success_rate: Number(info.success_rate ?? 0),
      avg_latency_ms: Number(info.avg_latency_ms ?? 0),
      last_success_at: Number(info.last_success_at ?? 0),
      last_failure_at: Number(info.last_failure_at ?? 0),
      last_error: typeof info.last_error === "string" ? info.last_error.slice(0, 160) : "",
    });
  }

  // Sort: blocked first (longest cooldown leads), then half-open by consecutive failures, then
  // healthy. Users care about problems most, the table reflects that.
  entries.sort((a, b) => {
    const order = (entry: ModelEntry) => {
      if (entry.circuit_state === "open") return 0;
      if (entry.circuit_state === "half_open") return 1;
      if (entry.circuit_state === "closed") return 2;
      return 3;
    };
    const delta = order(a) - order(b);
    if (delta !== 0) return delta;
    if (a.circuit_state === "open" && b.circuit_state === "open") {
      return b.cooldown_remaining - a.cooldown_remaining;
    }
    if (a.circuit_state === "half_open" && b.circuit_state === "half_open") {
      return b.consecutive_failures - a.consecutive_failures;
    }
    return b.score - a.score;
  });

  let healthy = 0;
  let recovering = 0;
  let blocked = 0;
  for (const entry of entries) {
    if (entry.circuit_state === "open") blocked += 1;
    else if (entry.circuit_state === "half_open") recovering += 1;
    else if (entry.circuit_state === "closed") healthy += 1;
  }

  return {
    engineAvailable: true,
    totalModels: entries.length,
    healthy,
    recovering,
    blocked,
    models: entries,
    generatedAt: Date.now(),
    source: HEALTH_FILE,
  };
}

export type AgentPick = {
  agent: string;
  model_id: string | null;
  context_window?: number;
  capabilities?: string[];
  best_provider?: string;
  circuit_state?: string;
  error?: string;
};

export async function getAgentPicks(agents: string[] = KNOWN_AGENTS): Promise<AgentPick[]> {
  const results: AgentPick[] = [];
  for (const agent of agents) {
    const pick = await pickFallbackModel(agent);
    if (!pick) {
      results.push({ agent, model_id: null, error: "engine unavailable or no eligible model" });
      continue;
    }
    const provider = pick.best_provider as any;
    results.push({
      agent,
      model_id: pick.model_id,
      context_window: (pick as any).context_window,
      capabilities: pick.capabilities,
      best_provider: provider?.name,
      circuit_state: pick.circuit_state,
    });
  }
  return results;
}

export async function resetModelCircuit(modelId: string): Promise<{ ok: boolean; error?: string }> {
  if (!modelId || !/^[\w./:@+-]{1,120}$/.test(modelId)) {
    return { ok: false, error: "invalid model id" };
  }
  const raw = await runEngine(["reset-circuit", modelId]);
  // engine.py reset-circuit prints "Circuit reset for <id>" on success — anything non-null counts.
  checkCache.delete(modelId);
  for (const key of pickCache.keys()) pickCache.delete(key);
  if (raw === null) return { ok: false, error: "engine unavailable" };
  return { ok: true };
}
