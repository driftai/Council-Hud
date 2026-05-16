import "server-only";

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { redactAgentNames, safeReadText, shortHash } from "../helpers";

// Experiment Results adapter: reads a directory of per-experiment JSON files (typically
// `autoresearch/results/*.json`) where each file is a single object holding the multi-judge
// composite verdict. Surfaces the judge breakdown that pure history.jsonl can't show —
// individual judges, their sub-scores, and which mutations were tested.
//
// Each result file shape:
//   composite_score, kept, improvement, timestamp, experiment_id, mutations[],
//   benchmarks: { tool_latency, memory_quality, llm_judge, prompt_dna }  each {score, raw, unit, details}
//   weights_used: { ... } (optional, present in baseline)
//
// Walks newest-first by mtime, capped at source.limit (default 60). Avoids loading the
// full 74k-experiment archive each scan.
export const experimentResultsAdapter: SkillNexusAdapter = {
  type: "experimentResults",
  async scan(domain: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot> {
    const cfg = loadCouncilConfig();
    const path = String(domain.source?.path || "").trim();
    const limitSource = domain.source?.limit;
    const limit = typeof limitSource === "number" && limitSource > 0 ? limitSource : 60;
    const now = Date.now();

    if (!path) return base(domain, "unreachable", ["Source path is empty."]);

    let dirents: import("node:fs").Dirent[];
    try {
      dirents = await fs.readdir(path, { withFileTypes: true });
    } catch {
      return base(domain, "unreachable", ["Results directory not reachable."]);
    }

    // Experiment files are named `exp_<unix_ts>_<hex>.json` — Unix timestamp is right in the
    // filename, so we can rank by name DESCENDING without stat'ing 74k files. Falls back to
    // mtime stats for any file that doesn't follow this pattern (baseline.json etc.).
    const total = dirents.length;
    const candidates: Array<{ name: string; full: string; mtime: number; tsFromName?: number }> = [];
    for (const entry of dirents) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const tsMatch = entry.name.match(/^exp_(\d+)_/);
      const tsFromName = tsMatch ? Number(tsMatch[1]) * 1000 : undefined;
      candidates.push({
        name: entry.name,
        full: join(path, entry.name),
        mtime: tsFromName ?? 0,
        tsFromName,
      });
    }
    // Sort by name-encoded timestamp; ties (no ts) at the end.
    candidates.sort((a, b) => (b.tsFromName ?? 0) - (a.tsFromName ?? 0));
    // Stat only the top slice we'll actually read — keeps the scan O(limit), not O(74k).
    const topN = candidates.slice(0, limit);
    for (const c of topN) {
      if (c.mtime === 0) {
        try {
          const stat = await fs.stat(c.full);
          c.mtime = stat.mtimeMs;
        } catch {
          // skip silently — file may have rolled while we were reading.
        }
      }
    }
    // Replace candidates with the just-stat'd top slice; the rest are kept in `total` count only.
    const candidateTotal = candidates.length;
    candidates.length = 0;
    candidates.push(...topN);

    const items: SkillNexusItem[] = [];
    let problemCount = 0;
    let keptCount = 0;
    const judgeAggregate: Record<string, { count: number; sum: number }> = {};

    for (const entry of candidates.slice(0, limit)) {
      const read = await safeReadText(entry.full, cfg.skillNexus.maxFileBytes);
      if (!read || "oversized" in read) continue;

      let parsed: any;
      try { parsed = JSON.parse(read.content); }
      catch { continue; }
      if (!parsed || typeof parsed !== "object") continue;

      const expId: string = String(parsed.experiment_id || entry.name.replace(/\.json$/, ""));
      const composite = Number(parsed.composite_score ?? 0);
      const kept = parsed.kept === true;
      const improvement = Number(parsed.improvement ?? 0);
      const timestamp = parsed.timestamp ? Date.parse(String(parsed.timestamp)) : entry.mtime;
      const benchmarks = parsed.benchmarks && typeof parsed.benchmarks === "object" ? parsed.benchmarks : {};
      const mutations = Array.isArray(parsed.mutations) ? parsed.mutations : [];

      // Extract each judge's per-dimension score so the HUD can show what each judge
      // contributed. llm_judge embeds sub-dimensions in `details` as "task=X, error=Y, …".
      const judges: Record<string, { score: number; raw?: number; unit?: string; details?: string }> = {};
      for (const [name, value] of Object.entries<any>(benchmarks)) {
        if (!value || typeof value !== "object") continue;
        judges[name] = {
          score: Number(value.score ?? 0),
          raw: typeof value.raw === "number" ? value.raw : undefined,
          unit: typeof value.unit === "string" ? value.unit : undefined,
          details: typeof value.details === "string" ? value.details : undefined,
        };
        if (!judgeAggregate[name]) judgeAggregate[name] = { count: 0, sum: 0 };
        judgeAggregate[name].count += 1;
        judgeAggregate[name].sum += Number(value.score ?? 0);
      }

      if (kept) keptCount += 1;
      // Non-kept trials (the vast majority of evolutionary trials) are expected outcomes,
      // not errors. Map them to "rejected" so they don't flood the Issues feed — and don't
      // count them in problemCount either, since the domain header would otherwise show
      // 60/60 problems and tint the whole panel red.
      const status: SkillNexusItem["status"] = kept ? "ok" : "rejected";
      if (status !== "ok" && status !== "rejected") problemCount += 1;

      // Surface judge sub-scores in meta keyed by judge name, plus the llm_judge breakdown
      // (task / error / token / decision / context) parsed from details when present.
      const meta: Record<string, string | number | boolean> = {
        composite: Math.round(composite * 1000) / 1000,
        kept,
        improvement: Math.round(improvement * 1000) / 1000,
        mutations: mutations.length,
        judges: Object.keys(judges).join(","),
      };
      for (const [name, info] of Object.entries(judges)) {
        meta[`judge_${name}`] = Math.round(info.score * 1000) / 1000;
      }
      const llmJudgeDetails = judges.llm_judge?.details;
      if (llmJudgeDetails) {
        // "task=8, error=5, token=4, decision=6, context=7" → key/val pairs
        const dims = llmJudgeDetails.split(/,\s*/);
        for (const pair of dims) {
          const [k, v] = pair.split("=").map((s) => s.trim());
          const num = Number(v);
          if (k && Number.isFinite(num)) meta[`llm_${k}`] = num;
        }
      }

      // Top mutation categories (gives a quick "what was tested" signal).
      const mutationCats = mutations
        .map((m: any) => typeof m === "object" ? String(m.category || m.gene || "") : "")
        .filter(Boolean)
        .slice(0, 4)
        .join(", ");
      if (mutationCats) meta["tested"] = mutationCats;

      items.push({
        id: shortHash(expId),
        name: redactAgentNames(expId),
        description: redactAgentNames(
          llmJudgeDetails
            ? `LLM judge: ${llmJudgeDetails}`
            : `composite ${composite.toFixed(3)} · ${mutations.length} mutation${mutations.length === 1 ? "" : "s"}`
        ),
        mtime: timestamp,
        status,
        tags: ["experiment", ...(kept ? ["kept"] : ["rejected"])],
        meta,
      });
    }

    const warnings: string[] = [];
    if (candidateTotal > limit) {
      warnings.push(`Showing newest ${limit} of ${candidateTotal} experiments.`);
    }
    if (items.length === 0 && candidates.length > 0) {
      warnings.push("Result files present but none parsed cleanly.");
    }
    void total;

    // Aggregate judge stats go in domain meta so the HUD can show "avg llm_judge over last N".
    const judgeMeans: Record<string, number> = {};
    for (const [name, agg] of Object.entries(judgeAggregate)) {
      if (agg.count > 0) judgeMeans[`${name}_mean`] = Math.round((agg.sum / agg.count) * 1000) / 1000;
    }

    return {
      id: domain.id,
      label: domain.label,
      type: domain.type,
      enabled: domain.enabled !== false,
      health: items.length === 0 ? "empty" : (problemCount > items.length / 2 ? "degraded" : "ok"),
      itemCount: items.length,
      problemCount,
      warnings,
      items,
      generatedAt: now,
      meta: {
        totalFiles: candidateTotal,
        sampled: items.length,
        keptRate: items.length > 0 ? Math.round((keptCount / items.length) * 100) / 100 : 0,
        ...judgeMeans,
      },
    };
  },
};

function base(
  domain: SkillNexusDomainConfig,
  health: SkillNexusDomainSnapshot["health"],
  warnings: string[]
): SkillNexusDomainSnapshot {
  return {
    id: domain.id,
    label: domain.label,
    type: domain.type,
    enabled: domain.enabled !== false,
    health,
    itemCount: 0,
    problemCount: 0,
    warnings,
    items: [],
    generatedAt: Date.now(),
  };
}
