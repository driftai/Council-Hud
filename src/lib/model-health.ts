import "server-only";

import { promises as fs } from "node:fs";

import { loadCouncilConfig } from "@/lib/council-config";

// Lightweight read-side counterpart to the Smart Fallback v5 engine's model
// status. The engine carries an in-process DECOMMISSIONED_MODELS dict that
// decides which catalog entries should never route — but it isn't exposed as
// a JSON file. We mirror that list here so the HUD can flag genome / config
// references to deprecated models without spawning a Python subprocess on
// every request.
//
// Keep this list in sync with smart-fallback-v5/engine.py:DECOMMISSIONED_MODELS.
// When the engine's list changes, this list should change too. The HUD will
// fall back gracefully (status "unknown") for any model it doesn't recognise.
export const DECOMMISSIONED_MODELS: Record<string, { httpCode: number; reason: string }> = {
  "moonshotai/kimi-k2.5": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "moonshotai/kimi-k2-thinking": { httpCode: 410, reason: "NVIDIA NIM endpoint deprecated" },
  "minimaxai/minimax-m2.5": { httpCode: 410, reason: "NVIDIA NIM endpoint deprecated" },
  "minimaxai/minimax-m2.1": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "z-ai/glm4.7": { httpCode: 410, reason: "NVIDIA NIM endpoint deprecated" },
  "nvidia/nemotron-4-340b-instruct": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "meta/llama3-8b-instruct": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "meta/llama-4-scout-17b-16e-instruct": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "mistralai/devstral-2-123b-instruct-2512": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "mistralai/magistral-small-2506": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "deepseek-ai/deepseek-v3_1": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "deepseek-ai/deepseek-v3_2": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "deepseek-ai/deepseek-r1-distill-qwen-32b": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "deepseek-ai/deepseek-r1-distill-qwen-14b": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "deepseek-ai/deepseek-r1-distill-llama-8b": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "qwen/qwq-32b": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
  "microsoft/phi-4-mini-flash-reasoning": { httpCode: 404, reason: "NVIDIA NIM endpoint retired" },
};

export type ModelHealthStatus = "ok" | "unhealthy" | "decommissioned" | "unknown";

export type ModelHealthBadge = {
  modelRef: string;
  status: ModelHealthStatus;
  score?: number;
  reason?: string;
};

// Smart-fallback model-health.json shape:
//   { "lastUpdated": <ts>, "health": { <model_id>: { "score": N, ... } } }
type RawHealth = {
  lastUpdated?: number;
  health?: Record<string, { score?: number; circuit?: { state?: string; reason?: string } }>;
};

// Threshold below which a model is "unhealthy" but not decommissioned. The
// engine deboost-routes anything <25 in its graded search, so the same cutoff
// gives operators a consistent signal.
const UNHEALTHY_SCORE = 25;

// Genome fields that ALWAYS reference a model and should be checked. Adding new
// fields here as the autoresearch genome grows is cheap; the matcher tolerates
// any extra string fields that simply look like model refs even when not listed.
export const MODEL_GENOME_FIELDS = new Set([
  "heartbeat_model",
  "research_model",
  "judge_model",
  "tool_model",
  "summary_model",
]);

let cache: { healthMap: Map<string, number>; ageMs: number } | null = null;
const CACHE_TTL_MS = 15_000;

async function loadHealth(path: string): Promise<Map<string, number>> {
  const now = Date.now();
  if (cache && now - cache.ageMs < CACHE_TTL_MS) return cache.healthMap;
  let raw: RawHealth | null = null;
  try {
    raw = JSON.parse(await fs.readFile(path, "utf8")) as RawHealth;
  } catch {
    raw = null;
  }
  const map = new Map<string, number>();
  if (raw?.health) {
    for (const [modelId, info] of Object.entries(raw.health)) {
      const score = Number(info?.score);
      if (Number.isFinite(score)) map.set(modelId, score);
    }
  }
  cache = { healthMap: map, ageMs: now };
  return map;
}

// A genome value like "nvidia-speedsters/stepfun-ai/step-3.5-flash" carries
// both the provider prefix and the canonical model id. The Smart Fallback
// engine keys its DECOMMISSIONED list by the bare model id (e.g. "minimaxai/
// minimax-m2.5"), so we extract candidate ids by stripping known provider
// prefixes and checking the tail.
const PROVIDER_PREFIXES = [
  "nvidia-all-stars/",
  "nvidia-speedsters/",
  "nvidia-paid/",
  "openrouter/",
  "google/",
  "free-project/",
  "huggingface/",
];

function extractModelRefs(value: string): string[] {
  const refs = new Set<string>();
  refs.add(value);
  for (const prefix of PROVIDER_PREFIXES) {
    if (value.startsWith(prefix)) {
      refs.add(value.slice(prefix.length));
    }
  }
  return Array.from(refs);
}

export async function assessModel(value: unknown): Promise<ModelHealthBadge | null> {
  if (typeof value !== "string" || !value || value.length > 200) return null;
  // Strings that don't look like model refs (no slash, no dot, no dash) get a
  // quick early-out — autoresearch genomes mix model refs with things like
  // "low" / "normal" that should never carry a badge.
  if (!/[/.\-]/.test(value)) return null;

  const cfg = loadCouncilConfig();
  const healthMap = await loadHealth(cfg.smartFallback.healthFile);

  const candidates = extractModelRefs(value);

  for (const ref of candidates) {
    if (DECOMMISSIONED_MODELS[ref]) {
      const meta = DECOMMISSIONED_MODELS[ref];
      return {
        modelRef: value,
        status: "decommissioned",
        reason: `${meta.reason} (http-${meta.httpCode})`,
      };
    }
  }

  let bestScore: number | undefined;
  for (const ref of candidates) {
    const s = healthMap.get(ref);
    if (Number.isFinite(s as number)) {
      bestScore = bestScore === undefined ? (s as number) : Math.max(bestScore, s as number);
    }
  }

  if (bestScore === undefined) {
    // Model isn't in the smart-fallback registry (possibly an unmanaged provider
    // or a free model only OpenRouter knows about). Return unknown — the UI
    // can choose to render this as a subtle hint or skip it entirely.
    return { modelRef: value, status: "unknown" };
  }

  if (bestScore < UNHEALTHY_SCORE) {
    return {
      modelRef: value,
      status: "unhealthy",
      score: bestScore,
      reason: `Score ${bestScore.toFixed(0)} below ${UNHEALTHY_SCORE} threshold`,
    };
  }

  return { modelRef: value, status: "ok", score: bestScore };
}

// Walk a flat genome record and produce a {field → badge} map for every entry
// whose value looks like a model reference.
export async function assessGenomeModels(
  genome: Record<string, string | number> | undefined
): Promise<Record<string, ModelHealthBadge>> {
  if (!genome) return {};
  const out: Record<string, ModelHealthBadge> = {};
  for (const [key, value] of Object.entries(genome)) {
    // Always probe known model fields; for unknown keys, only probe when the
    // value clearly looks model-shaped (contains "/"). Prevents accidentally
    // badging a numeric setting that happens to be a string.
    const isModelField = MODEL_GENOME_FIELDS.has(key);
    if (!isModelField && (typeof value !== "string" || !value.includes("/"))) continue;
    const badge = await assessModel(value);
    if (badge) out[key] = badge;
  }
  return out;
}
