import "server-only";

import { spawn } from "node:child_process";

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
