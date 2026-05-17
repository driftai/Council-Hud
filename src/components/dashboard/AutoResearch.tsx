"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AlertCircle, BarChartHorizontal, ChevronDown, ChevronUp, Dna, FlaskConical, RefreshCcw, Target, TrendingUp } from "lucide-react";

type Trial = {
  experiment: number;
  id: string;
  score: number;
  improvement: number;
  kept: boolean;
  mutations: number;
  timestamp: number;
};

type Snapshot = {
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
  recentTrials: Trial[];
  trend: number[];
  restartCount: number;
  appliedGenome?: Record<string, string | number>;
  source: string;
};

// Format a kept-rate fraction without losing signal for extreme cases. Genetic
// algorithms running long enough to accumulate 50k+ trials routinely sit at
// rates like 0.00013 — rounding to "0.0%" buries the actual success rate, so
// the formatter scales precision dynamically.
function formatKeptRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "0%";
  const pct = rate * 100;
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(3)}%`;
}

function formatAge(epochSeconds: number) {
  if (!epochSeconds || epochSeconds <= 0) return "never";
  const delta = Date.now() / 1000 - epochSeconds;
  if (delta < 0) return "soon";
  if (delta < 60) return `${Math.round(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

// Cheap sparkline — N normalized points rendered as a polyline.
function Sparkline({ values, width = 110, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.001);
  const stepX = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="text-secondary/80">
      <polyline fill="none" stroke="currentColor" strokeWidth="1" points={points} />
    </svg>
  );
}

// Build a score-distribution histogram from a trial list. Five bins covering the
// useful range (<0.6 through >=0.9) reveal at a glance how tightly the recent
// trials cluster around the best score — the canonical convergence signal in
// genetic-algorithm dashboards (MATLAB's `gaplotscorediversity` does the same).
type DistBin = { label: string; min: number; max: number; count: number; isBestBand: boolean };
function buildScoreDistribution(trials: Trial[], bestScore: number): DistBin[] {
  const bins: DistBin[] = [
    { label: "<0.60", min: -Infinity, max: 0.6, count: 0, isBestBand: false },
    { label: "0.60–0.70", min: 0.6, max: 0.7, count: 0, isBestBand: false },
    { label: "0.70–0.80", min: 0.7, max: 0.8, count: 0, isBestBand: false },
    { label: "0.80–0.90", min: 0.8, max: 0.9, count: 0, isBestBand: false },
    { label: "≥0.90", min: 0.9, max: Infinity, count: 0, isBestBand: false },
  ];
  for (const t of trials) {
    const bin = bins.find((b) => t.score >= b.min && t.score < b.max);
    if (bin) bin.count += 1;
  }
  for (const bin of bins) {
    bin.isBestBand = bestScore >= bin.min && bestScore < bin.max;
  }
  return bins;
}

// Surface the trials whose score came closest to the current best — these are
// the experiments worth investigating next. A regressed trial that landed at
// 0.825 is more informative than 28 others that landed at 0.76.
function findNearMisses(trials: Trial[], limit = 3): Trial[] {
  return trials.slice().sort((a, b) => b.score - a.score).slice(0, limit);
}

function summarizeMutations(trials: Trial[]): { min: number; max: number; median: number } | null {
  if (trials.length === 0) return null;
  const muts = trials.map((t) => t.mutations).sort((a, b) => a - b);
  return {
    min: muts[0],
    max: muts[muts.length - 1],
    median: muts[Math.floor(muts.length / 2)],
  };
}

export function AutoResearch() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Collapsed by default — the distribution + near-misses summary is enough for
  // the routine glance. Operators can expand to the full per-trial list when
  // forensics are needed (e.g. "what mutated on exp 53458 that scored 0.825?").
  const [showAllTrials, setShowAllTrials] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetch("/api/council/autoresearch", { cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(typeof data.error === "string" ? data.error : `HTTP ${r.status}`);
        return;
      }
      setSnap(data.snapshot as Snapshot);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "AutoResearch fetch failed");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(true), 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const available = Boolean(snap?.available);
  const trend = snap?.trend ?? [];
  const lastTrend = trend.length > 0 ? trend[trend.length - 1] : 0;
  const trendDelta = trend.length >= 2 ? lastTrend - trend[0] : 0;

  const trials = snap?.recentTrials ?? [];
  const trialsCount = trials.length;
  const regressed = useMemo(() => trials.filter((t) => t.improvement < 0).length, [trials]);
  const kept = useMemo(() => trials.filter((t) => t.kept).length, [trials]);
  const neutral = trialsCount - regressed - kept;
  const distribution = useMemo(
    () => buildScoreDistribution(trials, snap?.bestScore ?? 0),
    [trials, snap?.bestScore]
  );
  const distributionMax = distribution.reduce((acc, b) => Math.max(acc, b.count), 0) || 1;
  const nearMisses = useMemo(() => findNearMisses(trials, 3), [trials]);
  const mutationSummary = useMemo(() => summarizeMutations(trials), [trials]);
  // Convergence label — high regression % AND tight clustering means the loop has
  // found a local optimum and needs a bigger mutation magnitude or a strategy
  // shift. The dashboard surfaces this directly instead of making operators
  // count regress rows.
  const regressionRate = trialsCount > 0 ? regressed / trialsCount : 0;
  const convergence: "high" | "moderate" | "active" =
    regressionRate >= 0.95 ? "high" : regressionRate >= 0.7 ? "moderate" : "active";

  // Genome highlights — show the most operationally interesting fields first.
  const PRIORITY_KEYS = [
    "heartbeat_model", "research_model", "heartbeat_interval_minutes", "compaction_threshold",
    "reasoning_effort", "verbosity", "max_subagent_depth", "search_result_count",
  ];
  const orderedGenome = useMemo(() => {
    const g = snap?.bestGenome ?? {};
    const out: Array<[string, string | number]> = [];
    for (const k of PRIORITY_KEYS) if (k in g) out.push([k, g[k]]);
    for (const [k, v] of Object.entries(g)) if (!PRIORITY_KEYS.includes(k)) out.push([k, v]);
    return out;
  }, [snap?.bestGenome]);

  return (
    <DashboardCard
      title="AutoResearch"
      subtitle="Evolution Loop"
      headerAction={
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase",
              available ? "border-secondary/40 text-secondary" : "border-destructive/40 text-destructive"
            )}
            title={snap ? `Last experiment ${formatAge(snap.lastExperimentAt)}` : ""}
          >
            {available ? "loop live" : "loop offline"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 border-white/10 bg-transparent p-0 hover:bg-white/5"
            onClick={() => void refresh()}
            disabled={loading}
            title="Refresh autoresearch state"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {error && (
          <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 font-mono text-[9px] uppercase text-destructive">
            <AlertCircle className="h-3 w-3" />
            <span className="truncate" title={error}>{error}</span>
          </div>
        )}

        {/* === Top stat strip — primary metrics. Baseline is collapsed into a
             Δ tile (raw baseline = best when nothing has displaced the incumbent,
             so the standalone tile was redundant). Kept gets a readable
             count+percent format ("7 · 0.01%") instead of the cryptic "7/53484".
             Layout is Best · Δ vs baseline · Trials · Kept. === */}
        <div className="grid grid-cols-4 gap-2 font-mono text-[9px] uppercase">
          <div className="rounded border border-secondary/30 bg-secondary/5 px-2 py-1.5" title="Best composite fitness recorded so far">
            <div className="text-secondary">Best</div>
            <p className="mt-0.5 text-sm font-bold text-secondary">{snap ? snap.bestScore.toFixed(3) : "--"}</p>
          </div>
          {(() => {
            const delta = snap ? snap.bestScore - snap.baselineScore : 0;
            const pct = snap && snap.baselineScore > 0 ? (delta / snap.baselineScore) * 100 : 0;
            const stable = !snap || Math.abs(delta) < 0.0005;
            const tone = stable
              ? "border-white/10 text-muted-foreground"
              : delta > 0
              ? "border-secondary/30 text-secondary"
              : "border-destructive/30 text-destructive";
            return (
              <div
                className={cn("rounded border bg-black/20 px-2 py-1.5", tone)}
                title={stable
                  ? `Best equals baseline (${snap?.baselineScore.toFixed(3) ?? "--"}) — incumbent genome dominates`
                  : `Improvement of ${delta.toFixed(3)} over baseline ${snap?.baselineScore.toFixed(3)}`}
              >
                <div className="opacity-80">Δ vs base</div>
                <p className="mt-0.5 text-sm font-bold">
                  {stable ? "stable" : `${delta > 0 ? "+" : ""}${pct.toFixed(2)}%`}
                </p>
              </div>
            );
          })()}
          <div className="rounded border border-primary/30 bg-primary/5 px-2 py-1.5" title="Total experiments run since the loop started">
            <div className="text-primary">Trials</div>
            <p className="mt-0.5 text-sm font-bold text-primary">{snap ? snap.totalExperiments.toLocaleString() : "--"}</p>
          </div>
          <div className="rounded border border-yellow-500/30 bg-yellow-500/5 px-2 py-1.5" title="Trials whose composite score beat the kept-bar (the loop's success rate)">
            <div className="text-yellow-400">Kept</div>
            <p className="mt-0.5 text-sm font-bold text-yellow-400">
              {snap
                ? `${snap.kept} · ${formatKeptRate(snap.keptRate)}`
                : "--"}
            </p>
          </div>
        </div>

        {trend.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-2 py-1.5">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3 w-3 text-secondary/80" />
              <span className="font-mono text-[9px] uppercase text-muted-foreground">Recent {trend.length} trials</span>
            </div>
            <Sparkline values={trend} />
            <span
              className={cn(
                "font-mono text-[9px] uppercase",
                trendDelta > 0 ? "text-secondary" : trendDelta < 0 ? "text-destructive/80" : "text-muted-foreground"
              )}
            >
              {trendDelta > 0 ? "+" : ""}{(trendDelta * 100).toFixed(1)}%
            </span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 font-mono text-[9px] uppercase">
          <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5" title="Mutation magnitude — how aggressive each trial's gene tweak is">
            <div className="text-muted-foreground">Magnitude</div>
            <p className="mt-0.5 text-xs font-bold text-foreground">{snap ? snap.currentMagnitude.toFixed(2) : "--"}</p>
          </div>
          {/* "Trials per keep" replaces the old Kept rate tile (which the top
              row's `Kept` already expresses as a percent). Inverted form — "1 per
              N trials" — is more intuitive for sparse-success regimes: a loop
              keeping 7 of 53,484 trials shows as "1 per 7,640" which conveys
              the difficulty far better than "0.0%". */}
          <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5" title="On average, how many trials run between two kept genomes">
            <div className="text-muted-foreground">Trials/keep</div>
            <p className="mt-0.5 text-xs font-bold text-foreground">
              {snap && snap.kept > 0
                ? `1 per ${Math.round(snap.totalExperiments / snap.kept).toLocaleString()}`
                : snap
                ? "—"
                : "--"}
            </p>
          </div>
          <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5" title="Number of process restarts the loop has logged">
            <div className="text-muted-foreground">Restarts</div>
            <p className="mt-0.5 text-xs font-bold text-foreground">{snap?.restartCount ?? "--"}</p>
          </div>
        </div>

        <div className="rounded border border-white/10 bg-black/20 p-2">
          <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase text-muted-foreground">
            <Dna className="h-3 w-3 text-primary" />
            <span>Best genome (current target)</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[9px]">
            {orderedGenome.slice(0, 10).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span className="truncate text-muted-foreground/80" title={k}>{k}</span>
                <span className="shrink-0 text-foreground/80" title={String(v)}>
                  {typeof v === "string" && v.length > 18 ? `…${v.slice(-16)}` : String(v)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* === Recent-window summary === */}
        {trialsCount > 0 && (
          <div className="rounded border border-white/10 bg-black/30 p-2">
            <div className="mb-1.5 flex items-center justify-between gap-1 font-mono text-[9px] uppercase text-muted-foreground">
              <div className="flex items-center gap-1">
                <BarChartHorizontal className="h-3 w-3 text-primary" />
                <span>Recent {trialsCount} trials · </span>
                <span className="text-foreground/80">{regressed} regress</span>
                {kept > 0 && <span className="text-secondary">· {kept} kept</span>}
                {neutral > 0 && <span className="text-muted-foreground">· {neutral} neutral</span>}
              </div>
              <span
                className={cn(
                  "rounded border px-1.5 py-px text-[8px]",
                  convergence === "high"
                    ? "border-yellow-500/40 text-yellow-300"
                    : convergence === "moderate"
                    ? "border-primary/40 text-primary"
                    : "border-secondary/40 text-secondary"
                )}
                title={
                  convergence === "high"
                    ? "Near-total regression — loop has found a local optimum. Bigger magnitude or strategy shift may unlock new ground."
                    : convergence === "moderate"
                    ? "Most trials regress, but the trial space is still varied enough to keep searching."
                    : "Plenty of improvements still landing — exploration is active."
                }
              >
                convergence: {convergence}
              </span>
            </div>

            {/* Score-bin histogram. The best-score band gets a primary tint so
                operators can read "where do trials fall relative to the bar?" at a glance. */}
            <div className="space-y-0.5">
              {distribution.map((bin) => (
                <div key={bin.label} className="flex items-center gap-1.5 font-mono text-[8px]">
                  <span className={cn("w-16 shrink-0", bin.isBestBand ? "text-primary" : "text-muted-foreground/80")}>
                    {bin.label}
                  </span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded bg-white/5">
                    <div
                      className={cn(
                        "h-full",
                        bin.isBestBand ? "bg-primary/60" : bin.count === 0 ? "bg-transparent" : "bg-secondary/40"
                      )}
                      style={{ width: `${(bin.count / distributionMax) * 100}%` }}
                    />
                  </div>
                  <span className={cn("w-6 shrink-0 text-right", bin.count === 0 ? "text-muted-foreground/40" : "text-foreground/80")}>
                    {bin.count}
                  </span>
                </div>
              ))}
            </div>

            {mutationSummary && (
              <div className="mt-1.5 flex items-center justify-between font-mono text-[8px] uppercase text-muted-foreground/80">
                <span>mutations · min {mutationSummary.min} · median {mutationSummary.median} · max {mutationSummary.max}</span>
              </div>
            )}
          </div>
        )}

        {/* === Near-misses (top 3 of the recent window) === */}
        {nearMisses.length > 0 && (
          <div className="rounded border border-white/10 bg-black/30 p-2">
            <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase text-muted-foreground">
              <Target className="h-3 w-3 text-primary" />
              <span>Closest to best ({snap?.bestScore.toFixed(3) ?? "--"})</span>
            </div>
            <div className="space-y-0.5">
              {nearMisses.map((t) => {
                const gap = (snap?.bestScore ?? 0) - t.score;
                return (
                  <div
                    key={t.id || `${t.experiment}`}
                    className={cn(
                      "flex items-center gap-2 rounded border px-2 py-0.5 font-mono text-[9px]",
                      t.kept ? "border-secondary/30 bg-secondary/5" : "border-white/10 bg-white/[0.02]"
                    )}
                  >
                    <span className="shrink-0 text-muted-foreground/60">#{t.experiment}</span>
                    <span className="flex-1 truncate text-foreground/80">
                      {t.score.toFixed(3)}
                      <span className="ml-1 text-[8px] text-muted-foreground/70">
                        ({gap >= 0 ? "−" : "+"}{Math.abs(gap).toFixed(3)} from best)
                      </span>
                    </span>
                    <span className="shrink-0 text-[8px] uppercase text-muted-foreground/60">{t.mutations}mut</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* === Full trial list (collapsible — keeps the per-trial detail accessible) === */}
        {trialsCount > 0 && (
          <div className="rounded border border-white/10 bg-black/30 p-2">
            <button
              type="button"
              onClick={() => setShowAllTrials((v) => !v)}
              className="flex w-full items-center justify-between gap-1 font-mono text-[9px] uppercase text-muted-foreground hover:text-foreground"
              aria-expanded={showAllTrials}
            >
              <div className="flex items-center gap-1">
                <FlaskConical className="h-3 w-3 text-primary" />
                <span>{showAllTrials ? "Hide" : "Show"} all {trialsCount} trials</span>
              </div>
              {showAllTrials ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showAllTrials && (
              <ScrollArea className="mt-1.5 h-[160px]">
                <div className="space-y-0.5">
                  {trials.map((t) => (
                    <div
                      key={t.id || `${t.experiment}`}
                      className={cn(
                        "flex items-center gap-2 rounded border px-2 py-0.5 font-mono text-[9px]",
                        t.kept ? "border-secondary/30 bg-secondary/5" : "border-white/10 bg-white/[0.02]"
                      )}
                    >
                      <span className="shrink-0 text-muted-foreground/60">#{t.experiment}</span>
                      <span className={cn("shrink-0 rounded border px-1 text-[8px] uppercase",
                        t.kept ? "border-secondary/40 text-secondary"
                        : t.improvement < 0 ? "border-destructive/40 text-destructive/80"
                        : "border-white/10 text-muted-foreground"
                      )}>
                        {t.kept ? "kept" : t.improvement < 0 ? "regress" : "neutral"}
                      </span>
                      <span className="flex-1 truncate text-foreground/80">
                        score {t.score.toFixed(3)}
                        <span className={cn("ml-1 text-[8px]",
                          t.improvement > 0 ? "text-secondary/80" : t.improvement < 0 ? "text-destructive/80" : "text-muted-foreground/60")}>
                          ({t.improvement > 0 ? "+" : ""}{t.improvement.toFixed(3)})
                        </span>
                      </span>
                      <span className="shrink-0 text-[8px] uppercase text-muted-foreground/60">{t.mutations}mut</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}
        {trialsCount === 0 && (
          <div className="rounded border border-white/10 bg-black/30 p-2 font-mono text-[10px] text-muted-foreground/70">
            No recent trial data yet.
          </div>
        )}

        <div className="flex items-center justify-between font-mono text-[8px] uppercase text-muted-foreground">
          <span>last trial {formatAge(snap?.lastExperimentAt ?? 0)}</span>
          <span>auto-refresh 30s</span>
        </div>
      </div>
    </DashboardCard>
  );
}
