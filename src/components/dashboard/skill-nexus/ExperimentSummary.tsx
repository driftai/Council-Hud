"use client";

// Compact summary for the Judge Verdicts (experimentResults) domain in Skill
// Nexus. Without this, the panel renders 60 nearly-identical "rejected" rows
// that all read the same way — pure bloat. The summary collapses them into:
//   - aggregate composite + kept stats
//   - per-judge average bars (tool_latency / memory_quality / llm_judge / prompt_dna)
//   - per-LLM-dim average bars (task / error / token / decision / context)
//   - top 3 closest-to-kept (highest composite)
//   - mutation category histogram (which genes the loop tested most)
//
// The full per-item list still renders below the summary (paginated by the
// caller). Nothing is removed; bloat is just reframed as signal.

import { useMemo } from "react";

export type SkillNexusItem = {
  id: string;
  name: string;
  description?: string;
  mtime?: number;
  status?: string;
  meta?: Record<string, string | number | boolean>;
};

// Parse the compact "judges" / "llm" meta strings into number maps. The adapter
// emits these as space- or comma-delimited "key:value" / "key=value" pairs to
// keep the JSON payload small; we re-expand them here for averaging.
function parseKeyedString(value: unknown, sep: RegExp, kvSep: RegExp): Record<string, number> {
  if (typeof value !== "string" || !value) return {};
  const out: Record<string, number> = {};
  for (const pair of value.split(sep)) {
    const m = pair.trim().match(kvSep);
    if (!m) continue;
    const n = Number(m[2]);
    if (Number.isFinite(n)) out[m[1].trim()] = n;
  }
  return out;
}

const parseJudges = (raw: unknown) => parseKeyedString(raw, /\s+/, /^([a-z_]+):(.+)$/i);
const parseLlmDims = (raw: unknown) => parseKeyedString(raw, /,/, /^([a-z_]+)\s*=\s*(.+)$/i);

type DimStat = { key: string; avg: number; max: number; min: number; n: number };

function buildDimStats(items: SkillNexusItem[], extract: (meta: Record<string, any>) => Record<string, number>): DimStat[] {
  const buckets: Record<string, number[]> = {};
  for (const item of items) {
    const meta = item.meta || {};
    const parsed = extract(meta);
    for (const [k, v] of Object.entries(parsed)) {
      if (!buckets[k]) buckets[k] = [];
      buckets[k].push(v);
    }
  }
  return Object.entries(buckets)
    .map(([key, values]) => ({
      key,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      max: Math.max(...values),
      min: Math.min(...values),
      n: values.length,
    }))
    .sort((a, b) => b.avg - a.avg);
}

function countMutationCategories(items: SkillNexusItem[]): Array<{ category: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const tested = item.meta?.tested;
    if (typeof tested !== "string") continue;
    for (const cat of tested.split(/,\s*/)) {
      const c = cat.trim();
      if (!c) continue;
      counts[c] = (counts[c] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

function DimBar({ stat, max }: { stat: DimStat; max: number }) {
  const pct = max > 0 ? (stat.avg / max) * 100 : 0;
  return (
    <div className="flex items-center gap-1.5 font-mono text-[8px]">
      <span className="w-20 shrink-0 truncate text-muted-foreground/80" title={stat.key}>{stat.key}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded bg-white/5">
        <div className="h-full bg-secondary/50" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-foreground/80">{stat.avg.toFixed(2)}</span>
      <span className="w-12 shrink-0 text-right text-muted-foreground/60">/{stat.max}</span>
    </div>
  );
}

export function ExperimentSummary({ items }: { items: SkillNexusItem[] }) {
  const aggregate = useMemo(() => {
    let composite = 0, improvement = 0, kept = 0, composites = 0;
    for (const it of items) {
      const m = it.meta || {};
      if (typeof m.composite === "number") {
        composite += m.composite;
        composites += 1;
      }
      if (typeof m.improvement === "number") improvement += m.improvement;
      if (m.kept === true) kept += 1;
    }
    return {
      count: items.length,
      kept,
      regressed: items.length - kept,
      avgComposite: composites > 0 ? composite / composites : 0,
      avgImprovement: items.length > 0 ? improvement / items.length : 0,
    };
  }, [items]);

  const judgeStats = useMemo(
    () => buildDimStats(items, (m) => parseJudges(m.judges)),
    [items]
  );
  const llmStats = useMemo(
    () => buildDimStats(items, (m) => parseLlmDims(m.llm)),
    [items]
  );
  const topByComposite = useMemo(
    () => items.slice().sort((a, b) => (Number(b.meta?.composite) || 0) - (Number(a.meta?.composite) || 0)).slice(0, 3),
    [items]
  );
  const mutationCats = useMemo(() => countMutationCategories(items).slice(0, 5), [items]);

  if (items.length === 0) return null;

  return (
    <div className="space-y-2 rounded border border-white/10 bg-black/30 p-2 font-mono text-[9px]">
      {/* Header — at-a-glance outcome distribution */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 uppercase">
        <div className="flex items-baseline gap-2">
          <span className="text-foreground/80">{aggregate.count} verdicts</span>
          {aggregate.kept > 0 && <span className="text-secondary">· {aggregate.kept} kept</span>}
          <span className="text-muted-foreground">· {aggregate.regressed} regressed</span>
        </div>
        <div className="text-muted-foreground">
          avg composite <span className="text-foreground/80">{aggregate.avgComposite.toFixed(3)}</span>
          {" · "}
          avg Δ
          <span className={aggregate.avgImprovement < 0 ? "ml-1 text-destructive/80" : "ml-1 text-secondary"}>
            {aggregate.avgImprovement >= 0 ? "+" : ""}{aggregate.avgImprovement.toFixed(3)}
          </span>
        </div>
      </div>

      {/* Per-judge average bars */}
      {judgeStats.length > 0 && (
        <div className="rounded border border-white/5 bg-white/[0.02] p-1.5">
          <div className="mb-1 text-[8px] uppercase text-muted-foreground/70">Judge averages</div>
          <div className="space-y-0.5">
            {judgeStats.map((s) => <DimBar key={s.key} stat={s} max={s.max} />)}
          </div>
        </div>
      )}

      {/* LLM-judge sub-dim average bars */}
      {llmStats.length > 0 && (
        <div className="rounded border border-white/5 bg-white/[0.02] p-1.5">
          <div className="mb-1 text-[8px] uppercase text-muted-foreground/70">
            LLM judge dimensions ({llmStats[0].max <= 10 ? "0-10 scale" : "0-100 scale"})
          </div>
          <div className="space-y-0.5">
            {llmStats.map((s) => <DimBar key={s.key} stat={s} max={Math.max(s.max, 10)} />)}
          </div>
        </div>
      )}

      {/* Top by composite — the trials that came closest to kept */}
      {topByComposite.length > 0 && (
        <div className="rounded border border-white/5 bg-white/[0.02] p-1.5">
          <div className="mb-1 text-[8px] uppercase text-muted-foreground/70">Closest to kept (top 3)</div>
          <div className="space-y-0.5">
            {topByComposite.map((t) => (
              <div key={t.id} className="flex items-center gap-2 truncate">
                <span className="shrink-0 text-muted-foreground/60">#{(t.name.match(/exp_(\d+)/) || ["", "?"])[1]}</span>
                <span className="flex-1 truncate text-foreground/80">composite {Number(t.meta?.composite).toFixed(3)}</span>
                {typeof t.meta?.improvement === "number" && (
                  <span className={Number(t.meta.improvement) < 0 ? "text-destructive/80" : "text-secondary"}>
                    ({Number(t.meta.improvement) >= 0 ? "+" : ""}{Number(t.meta.improvement).toFixed(3)})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mutation category histogram — what the loop has been testing */}
      {mutationCats.length > 0 && (
        <div className="rounded border border-white/5 bg-white/[0.02] p-1.5">
          <div className="mb-1 text-[8px] uppercase text-muted-foreground/70">Most-tested mutation categories</div>
          <div className="flex flex-wrap gap-1">
            {mutationCats.map(({ category, count }) => (
              <span key={category} className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[8px]">
                {category} <span className="opacity-60">× {count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
