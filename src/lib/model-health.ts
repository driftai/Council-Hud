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

// Smart-fallback model-registry.json shape (relevant subset):
//   { "models": [ { "id": "...", "capabilities": [...], "providers": [...] } ] }
// Lives next to model-health.json. Used to suggest capability-matched healthy
// replacements for any model flagged decommissioned or unhealthy.
type RegistryModel = {
  id: string;
  display?: string;
  capabilities?: string[];
  providers?: Array<{ name?: string; model_ref?: string; api_key_env?: string }>;
};
type RawRegistry = {
  models?: RegistryModel[];
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

type CachedSources = {
  healthMap: Map<string, number>;
  registry: RegistryModel[];
  ageMs: number;
};
let cache: CachedSources | null = null;
const CACHE_TTL_MS = 15_000;

async function loadSources(healthPath: string): Promise<CachedSources> {
  const now = Date.now();
  if (cache && now - cache.ageMs < CACHE_TTL_MS) return cache;

  let rawHealth: RawHealth | null = null;
  try {
    rawHealth = JSON.parse(await fs.readFile(healthPath, "utf8")) as RawHealth;
  } catch {
    rawHealth = null;
  }
  const healthMap = new Map<string, number>();
  if (rawHealth?.health) {
    for (const [modelId, info] of Object.entries(rawHealth.health)) {
      const score = Number(info?.score);
      if (Number.isFinite(score)) healthMap.set(modelId, score);
    }
  }

  // model-registry.json lives in the same directory as model-health.json. Read
  // best-effort — when missing we still answer status queries, just without
  // capability-matched swap suggestions.
  const registryPath = healthPath.replace(/model-health\.json$/i, "model-registry.json");
  let registry: RegistryModel[] = [];
  try {
    const raw = JSON.parse(await fs.readFile(registryPath, "utf8")) as RawRegistry;
    registry = Array.isArray(raw?.models) ? raw.models : [];
  } catch {
    registry = [];
  }

  cache = { healthMap, registry, ageMs: now };
  return cache;
}

async function loadHealth(path: string): Promise<Map<string, number>> {
  return (await loadSources(path)).healthMap;
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

export type SwapSuggestion = {
  modelRef: string;
  score: number;
  capabilities: string[];
  capabilityOverlap: number;
};

// Find capability-matched healthy replacements for an unhealthy / decommissioned
// model. Strategy:
//   1. Look up the bad model in the registry to capture its capability list.
//   2. Score every other registry model by overlap with that capability set,
//      filtered to: not decommissioned, healthy score (>= UNHEALTHY_SCORE).
//   3. Return the top N by (overlap, score) tuple.
//
// When the bad model is missing from the registry we fall back to "top N
// healthy models" with no capability filter — useful when the genome carries
// an old reference that's been deleted from the registry.
export async function getHealthySwapSuggestions(
  badModelRef: string,
  limit = 3
): Promise<SwapSuggestion[]> {
  const cfg = loadCouncilConfig();
  const { healthMap, registry } = await loadSources(cfg.smartFallback.healthFile);
  if (registry.length === 0) return [];

  // Find the bad model's registry entry — search both by id and via stripped provider prefixes.
  const candidateRefs = new Set(extractModelRefs(badModelRef));
  const badEntry = registry.find((m) => candidateRefs.has(m.id));
  const targetCaps = new Set(badEntry?.capabilities || []);

  type Candidate = SwapSuggestion & { isDecommissioned: boolean };
  const scored: Candidate[] = [];
  for (const m of registry) {
    if (!m.id || candidateRefs.has(m.id)) continue;
    if (DECOMMISSIONED_MODELS[m.id]) continue;

    // Pick the best score across providers — a model is healthy if ANY provider
    // routes well, even when other providers for the same model are flaky.
    let best = healthMap.get(m.id) ?? -1;
    for (const provider of m.providers || []) {
      const providerKey = provider.model_ref || "";
      const providerScore = healthMap.get(providerKey);
      if (typeof providerScore === "number" && providerScore > best) best = providerScore;
    }
    if (best < UNHEALTHY_SCORE) continue;

    const caps = m.capabilities || [];
    const overlap = targetCaps.size === 0
      ? caps.length
      : caps.filter((c) => targetCaps.has(c)).length;

    scored.push({
      modelRef: m.id,
      score: best,
      capabilities: caps,
      capabilityOverlap: overlap,
      isDecommissioned: false,
    });
  }

  scored.sort((a, b) => {
    if (b.capabilityOverlap !== a.capabilityOverlap) return b.capabilityOverlap - a.capabilityOverlap;
    return b.score - a.score;
  });

  return scored.slice(0, limit).map(({ isDecommissioned: _unused, ...rest }) => rest);
}

// Build a {field → suggestions[]} map for any flagged entry in a genome health
// assessment. Healthy entries are skipped — only the rows that NEED swapping
// get suggestion lists, which keeps the payload tight.
export async function suggestGenomeSwaps(
  genomeHealth: Record<string, ModelHealthBadge>
): Promise<Record<string, SwapSuggestion[]>> {
  const out: Record<string, SwapSuggestion[]> = {};
  for (const [field, badge] of Object.entries(genomeHealth)) {
    if (badge.status !== "decommissioned" && badge.status !== "unhealthy") continue;
    const suggestions = await getHealthySwapSuggestions(badge.modelRef, 3);
    if (suggestions.length > 0) out[field] = suggestions;
  }
  return out;
}

// Total count of routable (score >= threshold, not decommissioned) provider×model
// pairings in the Smart Fallback registry. Used by the HUD as a single aggregate
// — "the loop has N healthy candidates to mutate over" — instead of prescribing
// specific swaps. Replaces the old top-3-per-field chip rendering which felt
// like a directive against autoresearch's own scoring.
export async function getHealthyPoolSize(): Promise<number> {
  const cfg = loadCouncilConfig();
  const { healthMap, registry } = await loadSources(cfg.smartFallback.healthFile);
  if (registry.length === 0) return 0;
  let count = 0;
  for (const m of registry) {
    if (!m.id || DECOMMISSIONED_MODELS[m.id]) continue;
    for (const provider of m.providers || []) {
      const score = Number(healthMap.get(provider.model_ref || "") ?? 0);
      if (score >= UNHEALTHY_SCORE) {
        count += 1;
        break; // count the model once; one healthy provider is enough
      }
    }
  }
  return count;
}
