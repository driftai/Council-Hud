import "server-only";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";

import { loadCouncilConfig } from "@/lib/council-config";

// Smart Fallback v5 bridge — consult the engine.py at the configured path (inside WSL) to find
// out whether a model is currently routable, pick a replacement when it isn't, and feed call
// outcomes back so the engine's view of HUD-side traffic stays current.
//
// All paths + agent identity come from council.config.local.json (or council.config.example.json
// if there's no local override). Every call is best-effort: if WSL or the engine isn't reachable,
// the helpers return null and the caller falls back to whatever model the user selected. We
// never block a chat turn on the engine being available.

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
  const cfg = loadCouncilConfig();
  return new Promise<string | null>((resolve) => {
    let resolved = false;
    const finish = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const child = spawn(
      "wsl.exe",
      ["-d", cfg.wsl.distro, "-u", cfg.wsl.user, "--", "python3", cfg.smartFallback.enginePath, ...args],
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

export async function pickFallbackModel(agent?: string): Promise<FallbackPick | null> {
  const resolvedAgent = agent || loadCouncilConfig().smartFallback.defaultAgent;
  return pickFallbackModelInternal(resolvedAgent);
}

async function pickFallbackModelInternal(agent: string): Promise<FallbackPick | null> {
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

export async function resolveRoutableModel(preferredModelId: string, agent?: string): Promise<{
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

export type ModelProviderInfo = {
  name: string;
  priority?: number;
  has_api_key_env?: boolean;
};

export type CapabilityEvidence = {
  capability: string;
  passes: number;
  fails: number;
};

export type ModelEntry = {
  model_id: string;
  circuit_state: "closed" | "open" | "half_open" | "unknown";
  cooldown_class: string;
  cooldown_remaining: number;
  score: number;
  consecutive_failures: number;
  total_calls: number;
  total_successes: number;
  total_errors: number;
  total_rate_limits: number;
  total_quota_exhaustions: number;
  total_timeouts: number;
  success_rate: number;
  avg_latency_ms: number;
  last_success_at: number;
  last_failure_at: number;
  last_error: string;
  // From model-health.circuit (deeper extraction)
  circuit_failure_count: number;
  circuit_success_count: number;
  circuit_opened_at: number;
  circuit_last_probe_at: number;
  // Derived from rate_limit_history
  rate_limit_recent_count: number; // last hour
  rate_limit_last_at: number;
  // From model-registry.json
  display_name?: string;
  context_window?: number;
  capabilities?: string[];
  providers?: ModelProviderInfo[];
  registry_known: boolean;
  // From model-intel.json
  capability_evidence?: CapabilityEvidence[];
  intel_last_probed_at?: number;
  // From probe-last-run.json
  last_probe_run_at?: number;
  // From agent session jsonl files — richer error than the engine's classifier.
  // The engine stores last_error as a class label ("timeout"/"rate_limit"/"other"),
  // but the actual prompt-error in the session file contains the full reason
  // ("LLM idle timeout (120s): no response from model" / "This operation was
  // aborted" / "stream stalled after 90s"). When present, this is what to
  // surface — way more diagnostic than "timeout".
  session_last_error?: string;
  session_last_error_at?: number;
  session_last_error_provider?: string;
};

// Aggregate verdict from the probe runner's content judges (math / json / instruct / etc.).
// Each capability becomes one judge — `passes` and `fails` are summed across every model
// in the catalog. Gives the HUD a single "how is judge X doing overall" number to display.
export type ProbeJudgeStat = {
  capability: string;
  passes: number;
  fails: number;
  models_with_evidence: number;
};

export type EngineSnapshot = {
  engineAvailable: boolean;
  registryAvailable: boolean;
  intelAvailable: boolean;
  totalModels: number;
  registryModelCount: number;
  healthy: number;
  recovering: number;
  blocked: number;
  decommissioned: number;
  rateLimitedRecently: number;
  models: ModelEntry[];
  generatedAt: number;
  source: string;
  healthLastUpdated: number;
  registryBuiltAt?: string;
  capabilityCoverage: Record<string, number>;
  probeJudges: ProbeJudgeStat[];
};

// Some health records use a `<provider>/<model_ref>` key from older engine versions
// (e.g. `nvidia-all-stars/z-ai/glm5`, `openrouter/qwen/qwen3-coder:free`). These don't
// match the canonical registry IDs so they show up as orphans. We can still recover
// the routing info by parsing the prefix — and inferring which API key the provider
// would have used from the provider-name → env-var mapping the engine itself defines.
const KNOWN_PROVIDER_PREFIXES = new Set([
  "nvidia",
  "nvidia-all-stars",
  "nvidia-reliables",
  "nvidia-speedsters",
  "openrouter",
  "openrouter-lockbox",
  "google",
  "google-antigravity",
  "github",
  "github-Experimental",
  "openclaw-set",
  "backup-processes",
  "free-project",
  "decommissioned-endpoints",
]);

function inferProviderFromKey(modelId: string): { provider: string; model_ref: string; api_key_env?: string } | null {
  const slash = modelId.indexOf("/");
  if (slash <= 0) return null;
  const provider = modelId.slice(0, slash);
  // Only treat as a provider prefix if it's in the known set — model_refs like "qwen/qwen3"
  // legitimately contain slashes but the first segment isn't a provider name.
  if (!KNOWN_PROVIDER_PREFIXES.has(provider)) return null;
  const model_ref = modelId.slice(slash + 1);
  let api_key_env: string | undefined;
  if (provider.includes("nvidia")) api_key_env = "NVIDIA_API_KEY";
  else if (provider.includes("openrouter")) api_key_env = "OPENROUTER_API_KEY";
  else if (provider.includes("google") || provider === "antigravity") api_key_env = "GOOGLE_API_KEY";
  else if (provider.includes("github")) api_key_env = "GITHUB_TOKEN";
  return { provider, model_ref, api_key_env };
}

// Derive sibling data files from the configured health file path. Registry, intel, and
// probe-last-run all live next to model-health.json in the engine's data dir.
function siblingPath(healthFile: string, fileName: string): string {
  // Works for both Windows UNC paths and POSIX paths because basename/dirname use the
  // active platform separators on Windows but tolerate forward slashes.
  return join(dirname(healthFile), fileName);
}

async function tryReadJson(path: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// === Session-error scanner ============================================
// The engine's `last_error` field only stores a high-level class label
// ("timeout"/"rate_limit"/"other") because that's all the recorder passes
// via `engine.py record <model> failure <kind>`. But the actual error
// reason lives in agent session files as `openclaw:prompt-error` events
// (timestamp, runId, provider, model, api, error). Scanning the tail of
// each agent's recent sessions surfaces the richest possible reason per
// model — exactly what the HUD watchlist needs to answer "WHY is this
// model blocked?" at a glance.

type SessionError = {
  at: number;        // unix ms
  error: string;     // truncated reason
  provider: string;  // from the prompt-error.data
};

// Tail-read the last ~32KB of a jsonl session file and parse just the lines
// we can. We DON'T need to deserialize the whole 50MB session — only the
// recent entries where prompt-errors are likely. JSONL is line-oriented so
// we drop the first (likely truncated) line after the seek.
async function readTailLines(path: string, tailBytes: number): Promise<string[]> {
  let stat: import("node:fs").Stats;
  try { stat = await fs.stat(path); } catch { return []; }
  const size = stat.size;
  if (size === 0) return [];
  const handle = await fs.open(path, "r");
  try {
    const start = size > tailBytes ? size - tailBytes : 0;
    const buf = Buffer.alloc(Math.min(size, tailBytes));
    await handle.read(buf, 0, buf.length, start);
    const raw = buf.toString("utf8");
    const lines = raw.split(/\r?\n/);
    // Drop the first if we seeked past file start (likely mid-line).
    return start > 0 ? lines.slice(1) : lines;
  } finally {
    await handle.close();
  }
}

// Walk a small fixed set of agent session directories, find recent
// prompt-error events, and aggregate by model id keeping the freshest
// occurrence. Designed to cost <50ms per snapshot fetch.
const AGENT_SESSION_DIRS = [
  "main",       // eve
  "prime",
  "echo",
  "vesper",
];
// Hub-relative under the WSL home. Resolved via the configured WSL user.
function sessionDir(agent: string, wslUser: string): string {
  // On Windows we read through wsl.localhost UNC; on Linux directly.
  if (process.platform === "win32") {
    return `\\\\wsl.localhost\\Ubuntu\\home\\${wslUser}\\.openclaw\\agents\\${agent}\\sessions`;
  }
  return `/home/${wslUser}/.openclaw/agents/${agent}/sessions`;
}

async function loadSessionErrors(wslUser: string): Promise<Map<string, SessionError>> {
  const out = new Map<string, SessionError>();
  const dirs = AGENT_SESSION_DIRS.map((a) => sessionDir(a, wslUser));
  await Promise.all(dirs.map(async (dir) => {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    // Take the 2 most-recently-modified .jsonl session files per agent
    // (skip *.trajectory.jsonl — those are tool-call traces, no prompt-errors).
    const candidates = names
      .filter((n) => n.endsWith(".jsonl") && !n.includes("trajectory"));
    const stats = await Promise.all(candidates.map(async (n) => {
      try {
        const s = await fs.stat(join(dir, n));
        return { name: n, mtime: s.mtimeMs };
      } catch {
        return null;
      }
    }));
    const recent = stats
      .filter((s): s is { name: string; mtime: number } => s !== null)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 2);

    for (const { name } of recent) {
      const lines = await readTailLines(join(dir, name), 64 * 1024);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Cheap filter before JSON.parse — every prompt-error line has the type tag.
        if (!trimmed.includes('"openclaw:prompt-error"')) continue;
        let obj: any;
        try { obj = JSON.parse(trimmed); } catch { continue; }
        if (obj?.type !== "custom" || obj.customType !== "openclaw:prompt-error") continue;
        const data = obj.data || {};
        const modelId = String(data.model || "").trim();
        if (!modelId) continue;
        const at = Number(data.timestamp) || (obj.timestamp ? Date.parse(obj.timestamp) : 0);
        if (!Number.isFinite(at) || at <= 0) continue;
        const error = String(data.error || data.message || "").replace(/\s+/g, " ").trim().slice(0, 200);
        if (!error) continue;
        const provider = String(data.provider || "");
        const prev = out.get(modelId);
        if (!prev || prev.at < at) {
          out.set(modelId, { at, error, provider });
        }
      }
    }
  }));
  return out;
}

export async function getEngineSnapshot(): Promise<EngineSnapshot> {
  const fallback: EngineSnapshot = {
    engineAvailable: false,
    registryAvailable: false,
    intelAvailable: false,
    totalModels: 0,
    registryModelCount: 0,
    healthy: 0,
    recovering: 0,
    blocked: 0,
    decommissioned: 0,
    rateLimitedRecently: 0,
    models: [],
    generatedAt: Date.now(),
    source: "unavailable",
    healthLastUpdated: 0,
    capabilityCoverage: {},
    probeJudges: [],
  };

  const cfg = loadCouncilConfig();
  const healthFile = cfg.smartFallback.healthFile;
  const registryFile = siblingPath(healthFile, "model-registry.json");
  const intelFile = siblingPath(healthFile, "model-intel.json");
  const probeFile = siblingPath(healthFile, "probe-last-run.json");

  let raw: string;
  try {
    raw = await fs.readFile(healthFile, "utf8");
  } catch {
    return fallback;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  // Read sibling files + session-error tails in parallel — all are optional.
  // sessionErrors gives us the rich "why did the model fail" reason from agent
  // session jsonl files, which the engine's stored `last_error` truncates to a
  // class label. The watchlist UI prefers session_last_error when available.
  const [registryDoc, intelDoc, probeDoc, sessionErrors] = await Promise.all([
    tryReadJson(registryFile),
    tryReadJson(intelFile),
    tryReadJson(probeFile),
    loadSessionErrors(cfg.wsl.user).catch(() => new Map<string, SessionError>()),
  ]);

  // Build a registry index keyed by model id. Strip base_url from providers — keeping only
  // the provider name + priority + a flag for whether an api_key_env is configured. This
  // avoids leaking infra URLs to the HUD client while still surfacing routing context.
  const registryIndex = new Map<string, {
    display: string;
    context_window: number;
    capabilities: string[];
    providers: ModelProviderInfo[];
  }>();
  let registryBuiltAt: string | undefined;
  if (registryDoc && Array.isArray(registryDoc.models)) {
    registryBuiltAt = typeof registryDoc.built_at === "string" ? registryDoc.built_at : undefined;
    for (const model of registryDoc.models) {
      if (!model || typeof model !== "object" || typeof model.id !== "string") continue;
      const providers: ModelProviderInfo[] = Array.isArray(model.providers)
        ? model.providers
            .filter((p: any) => p && typeof p === "object" && typeof p.name === "string")
            .map((p: any) => ({
              name: String(p.name),
              priority: typeof p.priority === "number" ? p.priority : undefined,
              has_api_key_env: typeof p.api_key_env === "string" && p.api_key_env.length > 0,
            }))
        : [];
      registryIndex.set(model.id, {
        display: typeof model.display === "string" ? model.display : model.id,
        context_window: Number(model.context_window || 0),
        capabilities: Array.isArray(model.capabilities) ? model.capabilities.filter((c: any) => typeof c === "string") : [],
        providers,
      });
    }
  }

  // Intel index: capability evidence + last_probed_at per model.
  const intelIndex = new Map<string, { evidence: CapabilityEvidence[]; last_probed_at: number }>();
  const intelModels = intelDoc?.models && typeof intelDoc.models === "object" ? intelDoc.models : intelDoc;
  if (intelModels && typeof intelModels === "object") {
    for (const [modelId, info] of Object.entries<any>(intelModels)) {
      if (!info || typeof info !== "object") continue;
      const evidence: CapabilityEvidence[] = [];
      const capEvidence = info.capability_evidence && typeof info.capability_evidence === "object" ? info.capability_evidence : {};
      for (const [cap, ev] of Object.entries<any>(capEvidence)) {
        if (!ev || typeof ev !== "object") continue;
        evidence.push({
          capability: cap,
          passes: Number(ev.passes ?? 0),
          fails: Number(ev.fails ?? 0),
        });
      }
      intelIndex.set(modelId, {
        evidence,
        last_probed_at: Number(info.last_probed_at ?? 0),
      });
    }
  }

  // Probe-last-run index: per-model last probe timestamp from the latest probe sweep.
  const probeIndex = new Map<string, number>();
  if (probeDoc && typeof probeDoc === "object" && !Array.isArray(probeDoc)) {
    for (const [modelId, info] of Object.entries<any>(probeDoc)) {
      if (!info || typeof info !== "object") continue;
      const ts = Number(info.last_probed_at ?? 0);
      if (ts > 0) probeIndex.set(modelId, ts);
    }
  }

  const health = parsed?.health && typeof parsed.health === "object" ? parsed.health : {};
  const healthLastUpdated = Number(parsed?.lastUpdated ?? 0);
  const now = Date.now() / 1000;
  const oneHourAgo = now - 3600;
  const entries: ModelEntry[] = [];
  let rateLimitedRecently = 0;
  const capabilityCoverage: Record<string, number> = {};
  const probeJudgeAgg = new Map<string, ProbeJudgeStat>();

  for (const [modelId, info] of Object.entries<any>(health)) {
    if (!info || typeof info !== "object") continue;
    const circuit = info.circuit && typeof info.circuit === "object" ? info.circuit : {};
    const cooldownUntil = Number(circuit.cooldown_until || 0);
    const cooldownRemaining = cooldownUntil > now ? cooldownUntil - now : 0;
    const stateRaw = String(circuit.state || "unknown");
    const state = stateRaw === "closed" || stateRaw === "open" || stateRaw === "half_open"
      ? stateRaw as ModelEntry["circuit_state"]
      : "unknown";

    const rateLimitHistory = Array.isArray(info.rate_limit_history) ? info.rate_limit_history : [];
    const recentRateLimits = rateLimitHistory.filter((ts: any) => Number(ts) >= oneHourAgo).length;
    const lastRateLimit = rateLimitHistory.length > 0 ? Number(rateLimitHistory[rateLimitHistory.length - 1]) : 0;
    if (recentRateLimits > 0) rateLimitedRecently += 1;

    const registryInfo = registryIndex.get(modelId);
    const intelInfo = intelIndex.get(modelId);
    const probeRun = probeIndex.get(modelId);

    if (registryInfo) {
      for (const cap of registryInfo.capabilities) {
        capabilityCoverage[cap] = (capabilityCoverage[cap] || 0) + 1;
      }
    }
    // Aggregate probe-judge outcomes across the catalog so the HUD can show "math judge:
    // 28 passes / 53 fails across 41 models". Each capability in the intel file's
    // capability_evidence is one judge.
    if (intelInfo) {
      for (const ev of intelInfo.evidence) {
        let stat = probeJudgeAgg.get(ev.capability);
        if (!stat) {
          stat = { capability: ev.capability, passes: 0, fails: 0, models_with_evidence: 0 };
          probeJudgeAgg.set(ev.capability, stat);
        }
        stat.passes += ev.passes;
        stat.fails += ev.fails;
        if (ev.passes > 0 || ev.fails > 0) stat.models_with_evidence += 1;
      }
    }

    entries.push({
      model_id: modelId,
      circuit_state: state,
      cooldown_class: String(circuit.cooldown_class || "occasional"),
      cooldown_remaining: Math.round(cooldownRemaining),
      score: Number(info.score ?? 0),
      consecutive_failures: Number(info.consecutive_failures ?? 0),
      total_calls: Number(info.total_calls ?? 0),
      total_successes: Number(info.total_successes ?? 0),
      total_errors: Number(info.total_errors ?? 0),
      total_rate_limits: Number(info.total_rate_limits ?? 0),
      total_quota_exhaustions: Number(info.total_quota_exhaustions ?? 0),
      total_timeouts: Number(info.total_timeouts ?? 0),
      success_rate: Number(info.success_rate ?? 0),
      avg_latency_ms: Number(info.avg_latency_ms ?? 0),
      last_success_at: Number(info.last_success_at ?? 0),
      last_failure_at: Number(info.last_failure_at ?? 0),
      last_error: typeof info.last_error === "string" ? info.last_error.slice(0, 160) : "",
      circuit_failure_count: Number(circuit.failure_count ?? 0),
      circuit_success_count: Number(circuit.success_count ?? 0),
      circuit_opened_at: Number(circuit.opened_at ?? 0),
      circuit_last_probe_at: Number(circuit.last_probe_at ?? 0),
      rate_limit_recent_count: recentRateLimits,
      rate_limit_last_at: lastRateLimit,
      ...(registryInfo
        ? {
            display_name: registryInfo.display,
            context_window: registryInfo.context_window,
            capabilities: registryInfo.capabilities,
            providers: registryInfo.providers,
            registry_known: true,
          }
        : (() => {
            // Orphan record: try to recover the provider from a `<provider>/<model_ref>`
            // key shape used by older engine versions. We still report registry_known=false
            // so the HUD can show an "orphan" badge, but provider info is no longer "?".
            const inferred = inferProviderFromKey(modelId);
            if (inferred) {
              return {
                registry_known: false,
                display_name: inferred.model_ref,
                providers: [{
                  name: inferred.provider,
                  has_api_key_env: typeof inferred.api_key_env === "string",
                }],
              };
            }
            return { registry_known: false };
          })()),
      ...(intelInfo
        ? {
            capability_evidence: intelInfo.evidence,
            intel_last_probed_at: intelInfo.last_probed_at,
          }
        : {}),
      ...(probeRun ? { last_probe_run_at: probeRun } : {}),
      // Session-error overlay — the engine stores a class label ("timeout"); the
      // session captures the actual reason ("LLM idle timeout (120s): no response").
      // Try the bare model_id first, then strip any provider prefix (for
      // health-records keyed `<provider>/<model_ref>` shape).
      ...(() => {
        const direct = sessionErrors.get(modelId);
        if (direct) return {
          session_last_error: direct.error,
          session_last_error_at: direct.at,
          session_last_error_provider: direct.provider,
        };
        const inferred = inferProviderFromKey(modelId);
        if (inferred) {
          const stripped = sessionErrors.get(inferred.model_ref);
          if (stripped) return {
            session_last_error: stripped.error,
            session_last_error_at: stripped.at,
            session_last_error_provider: stripped.provider,
          };
        }
        return {};
      })(),
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
  let decommissioned = 0;
  for (const entry of entries) {
    if (entry.cooldown_class === "decommissioned") {
      decommissioned += 1;
    } else if (entry.circuit_state === "open") {
      blocked += 1;
    } else if (entry.circuit_state === "half_open") {
      recovering += 1;
    } else if (entry.circuit_state === "closed") {
      healthy += 1;
    }
  }

  return {
    engineAvailable: true,
    registryAvailable: registryIndex.size > 0,
    intelAvailable: intelIndex.size > 0,
    totalModels: entries.length,
    registryModelCount: registryIndex.size,
    healthy,
    recovering,
    blocked,
    decommissioned,
    rateLimitedRecently,
    models: entries,
    generatedAt: Date.now(),
    // Only the basename of the source — full paths leak the WSL user/home dir.
    source: basename(healthFile),
    healthLastUpdated,
    registryBuiltAt,
    capabilityCoverage,
    probeJudges: Array.from(probeJudgeAgg.values()).sort((a, b) => (b.passes + b.fails) - (a.passes + a.fails)),
  };
}

export type AgentPick = {
  agent: string;
  model_id: string | null;
  context_window?: number;
  capabilities?: string[];
  best_provider?: string;
  circuit_state?: string;
  // From engine.py `chain` — the top 3 candidates with their composite score breakdown
  // so the UI can show why a particular model was chosen over another.
  alternates?: Array<{
    model_id: string;
    total_score?: number;
    capability_score?: number;
    stability_score?: number;
    cost_score?: number;
    context_score?: number;
    speed_score?: number;
    provider_affinity_score?: number;
    circuit_state?: string;
  }>;
  error?: string;
};

export async function getAgentPicks(agents?: string[]): Promise<AgentPick[]> {
  const resolvedAgents = agents && agents.length > 0 ? agents : loadCouncilConfig().smartFallback.agents;
  return getAgentPicksInternal(resolvedAgents);
}

// Engine's `chain` command yields the ranked candidates with weighted score components.
// Output shape (with --format dicts): { agent, pass, models: [{ eligible, model_id, context_window,
// capabilities, best_provider: {name, model_ref, api_key_env, base_url, priority}, cost_tier,
// circuit_state, scores: {capability, stability, cost, context, speed, provider_affinity},
// weighted, pass }] }. We strip base_url and api_key_env before bubbling up to the HUD client.
async function getChainOrPick(agent: string): Promise<{ pick: FallbackPick | null; chain: any[] }> {
  const chainRaw = await runEngine(["chain", "--agent", agent, "--limit", "3", "--format", "dicts"]);
  if (chainRaw) {
    const parsed = parseJson<any>(chainRaw);
    const candidates: any[] = Array.isArray(parsed?.models)
      ? parsed.models
      : Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.candidates)
          ? parsed.candidates
          : Array.isArray(parsed?.chain)
            ? parsed.chain
            : [];
    if (candidates.length > 0) {
      const top = candidates[0];
      // Strip provider internals — engine includes base_url + api_key_env we don't want client-side.
      const providerObj = top.best_provider && typeof top.best_provider === "object"
        ? { name: String(top.best_provider.name || "") }
        : typeof top.best_provider === "string"
          ? { name: top.best_provider }
          : undefined;
      const pick: FallbackPick = {
        eligible: Boolean(top.eligible ?? top.model_id),
        model_id: String(top.model_id || ""),
        capabilities: Array.isArray(top.capabilities) ? top.capabilities : undefined,
        best_provider: providerObj,
        circuit_state: typeof top.circuit_state === "string" ? top.circuit_state : undefined,
      };
      // Stash context_window on the pick for the AgentPick layer to forward.
      if (typeof top.context_window === "number") {
        (pick as any).context_window = top.context_window;
      }
      return { pick: pick.model_id ? pick : null, chain: candidates };
    }
  }
  const pick = await pickFallbackModel(agent);
  return { pick, chain: [] };
}

async function getAgentPicksInternal(agents: string[]): Promise<AgentPick[]> {
  const results: AgentPick[] = [];
  for (const agent of agents) {
    const { pick, chain } = await getChainOrPick(agent);
    if (!pick) {
      results.push({ agent, model_id: null, error: "engine unavailable or no eligible model" });
      continue;
    }
    const provider = pick.best_provider as any;
    const alternates = chain.slice(0, 3).map((entry: any) => {
      const scores = entry.scores && typeof entry.scores === "object" ? entry.scores : {};
      return {
        model_id: String(entry.model_id || ""),
        total_score: typeof entry.weighted === "number"
          ? entry.weighted
          : (typeof entry.total_score === "number" ? entry.total_score : undefined),
        capability_score: typeof scores.capability === "number" ? scores.capability : undefined,
        stability_score: typeof scores.stability === "number" ? scores.stability : undefined,
        cost_score: typeof scores.cost === "number" ? scores.cost : undefined,
        context_score: typeof scores.context === "number" ? scores.context : undefined,
        speed_score: typeof scores.speed === "number" ? scores.speed : undefined,
        provider_affinity_score: typeof scores.provider_affinity === "number" ? scores.provider_affinity : undefined,
        circuit_state: typeof entry.circuit_state === "string" ? entry.circuit_state : undefined,
      };
    }).filter((a: any) => a.model_id);
    results.push({
      agent,
      model_id: pick.model_id,
      context_window: (pick as any).context_window,
      capabilities: pick.capabilities,
      best_provider: provider?.name,
      circuit_state: pick.circuit_state,
      ...(alternates.length > 1 ? { alternates } : {}),
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

// === Reprobe blocked models ============================================
// Reset + reprobe every model whose last error indicates an environmental
// blocker (missing API key, timeout). The probe runner inside WSL reloads
// ~/.hermes/.env automatically (since the probe-script env-loader patch),
// so this picks up new credentials without restarting anything.
//
// The probe script lives at ~/.openclaw/workspace/scripts/probe_unused_models.py
// and accepts `--model <id>` to force a single-model probe bypassing the
// 24h recency cooldown. We loop one-by-one to bound per-call wall time.

const PROBE_SCRIPT_REL = "/.openclaw/workspace/scripts/probe_unused_models.py";

function runProbeForModel(modelId: string, timeoutMs = 40_000): Promise<{ ok: boolean; output: string }> {
  const cfg = loadCouncilConfig();
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value: { ok: boolean; output: string }) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    // probe_unused_models.py lives relative to the WSL user's home, not the engine dir.
    const probePath = `/home/${cfg.wsl.user}${PROBE_SCRIPT_REL}`;
    const child = spawn(
      "wsl.exe",
      ["-d", cfg.wsl.distro, "-u", cfg.wsl.user, "--", "python3", probePath, "--model", modelId],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, output: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ ok: false, output: `spawn error: ${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const tail = (stdout || stderr).trim().split("\n").slice(-3).join(" | ").slice(0, 240);
      finish({ ok: code === 0, output: tail });
    });
  });
}

export type ReprobeResult = {
  attempted: number;
  passed: number;
  failed: number;
  failures: Array<{ model_id: string; error: string }>;
};

export async function reprobeBlockedModels(opts?: { kinds?: string[]; max?: number }): Promise<ReprobeResult> {
  const kinds = opts?.kinds && opts.kinds.length > 0 ? opts.kinds : ["missing-env-", "timeout"];
  const maxModels = opts?.max ?? 40;

  const snapshot = await getEngineSnapshot();
  const targets = snapshot.models
    .filter((entry) => {
      const err = entry.last_error || "";
      return kinds.some((k) => k.endsWith("-") ? err.startsWith(k) : err === k);
    })
    .slice(0, maxModels)
    .map((entry) => entry.model_id);

  let passed = 0;
  let failed = 0;
  const failures: Array<{ model_id: string; error: string }> = [];

  for (const modelId of targets) {
    // Always reset first — the probe runner skips open-circuit models.
    await resetModelCircuit(modelId);
    const result = await runProbeForModel(modelId);
    if (result.ok) {
      passed += 1;
    } else {
      failed += 1;
      failures.push({ model_id: modelId, error: result.output });
    }
  }

  // Wipe routability caches so the HUD sees the fresh health immediately.
  checkCache.clear();
  pickCache.clear();

  return { attempted: targets.length, passed, failed, failures };
}
