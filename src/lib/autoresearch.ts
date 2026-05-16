import "server-only";

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

import { loadCouncilConfig } from "@/lib/council-config";

// AutoResearch is the openclaw evolution loop — a long-running optimization process that
// proposes mutations to the agent genome, evaluates each via a multi-judge composite, and
// either keeps or discards. This module reads its state files and exposes a HUD-friendly
// snapshot. All paths derive from the configured smartFallback workspace dir so a fresh
// machine without autoresearch deployed just sees "loop offline" — no crash.

export type AutoResearchTrial = {
  experiment: number;
  id: string;
  score: number;
  improvement: number;
  kept: boolean;
  mutations: number;
  timestamp: number;
};

export type AutoResearchSnapshot = {
  available: boolean;
  baselineScore: number;
  bestScore: number;
  currentMagnitude: number;
  totalExperiments: number;
  kept: number;
  discarded: number;
  keptRate: number;
  lastExperimentAt: number;
  bestGenome: Record<string, string | number>;
  recentTrials: AutoResearchTrial[];
  trend: number[]; // last ~30 trial scores for a sparkline
  restartCount: number;
  appliedGenome?: Record<string, string | number>;
  source: string;
};

const EMPTY: AutoResearchSnapshot = {
  available: false,
  baselineScore: 0,
  bestScore: 0,
  currentMagnitude: 0,
  totalExperiments: 0,
  kept: 0,
  discarded: 0,
  keptRate: 0,
  lastExperimentAt: 0,
  bestGenome: {},
  recentTrials: [],
  trend: [],
  restartCount: 0,
  source: "unavailable",
};

async function readJson(path: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return null;
  }
}

// JSONL tail: read the last `tailBytes` of a file and return parsed entries from
// the (newest-last) tail. Drops the first (likely truncated) line.
async function readJsonlTail(path: string, tailBytes = 96 * 1024): Promise<any[]> {
  try {
    const stat = await fs.stat(path);
    let raw: string;
    if (stat.size <= tailBytes) {
      raw = await fs.readFile(path, "utf8");
    } else {
      const fh = await fs.open(path, "r");
      try {
        const buf = Buffer.alloc(tailBytes);
        await fh.read(buf, 0, tailBytes, stat.size - tailBytes);
        raw = buf.toString("utf8");
        const first = raw.indexOf("\n");
        if (first >= 0) raw = raw.slice(first + 1);
      } finally {
        await fh.close();
      }
    }
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter((e) => e !== null);
  } catch {
    return [];
  }
}

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function flattenGenome(g: any): Record<string, string | number> {
  if (!g || typeof g !== "object") return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(g)) {
    if (typeof v === "string" && v.length < 200) out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export async function getAutoResearchSnapshot(): Promise<AutoResearchSnapshot> {
  const cfg = loadCouncilConfig();
  // The smartFallback healthFile points at .../data/smart-fallback-v5/model-health.json.
  // autoresearch sits at .../workspace/autoresearch/. Derive paths from healthFile root.
  const dataDir = dirname(cfg.smartFallback.healthFile);
  const workspaceDir = dirname(dirname(dataDir)); // strip data/<engine-dir>
  const autoresearchDir = join(workspaceDir, "autoresearch");

  const STATE = join(autoresearchDir, "state.json");
  const HISTORY = join(autoresearchDir, "history.jsonl");
  const APPLIED = join(autoresearchDir, "applied_genome.json");
  const RESTART = join(autoresearchDir, "restart_history.json");

  const state = await readJson(STATE);
  if (!state) return EMPTY;

  const tail = await readJsonlTail(HISTORY, 96 * 1024);
  const recent: AutoResearchTrial[] = tail
    .slice(-30)
    .map((entry) => ({
      experiment: safeNumber(entry.experiment),
      id: String(entry.id || ""),
      score: safeNumber(entry.score),
      improvement: safeNumber(entry.improvement),
      kept: Boolean(entry.kept),
      mutations: Array.isArray(entry.mutations) ? entry.mutations.length : 0,
      timestamp: safeNumber(entry.timestamp),
    }))
    .reverse(); // newest first for the UI

  const trend = tail.slice(-30).map((entry) => safeNumber(entry.score));

  const applied = await readJson(APPLIED);
  const restart = await readJson(RESTART);
  const restartCount = Array.isArray(restart) ? restart.length : Array.isArray(restart?.events) ? restart.events.length : 0;

  const kept = safeNumber(state.kept);
  const discarded = safeNumber(state.discarded);
  const totalExperiments = safeNumber(state.total_experiments);
  const keptRate = totalExperiments > 0 ? kept / totalExperiments : 0;

  return {
    available: true,
    baselineScore: safeNumber(state.baseline_score),
    bestScore: safeNumber(state.best_score),
    currentMagnitude: safeNumber(state.current_magnitude),
    totalExperiments,
    kept,
    discarded,
    keptRate,
    lastExperimentAt: safeNumber(state.last_experiment_ts),
    bestGenome: flattenGenome(state.best_genome),
    recentTrials: recent,
    trend,
    restartCount,
    appliedGenome: applied ? flattenGenome(applied) : undefined,
    source: "state.json",
  };
}
