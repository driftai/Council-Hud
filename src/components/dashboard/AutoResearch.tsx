"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AlertCircle, Dna, FlaskConical, RefreshCcw, TrendingUp } from "lucide-react";

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

export function AutoResearch() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

        <div className="grid grid-cols-4 gap-2 font-mono text-[9px] uppercase">
          <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
            <div className="text-muted-foreground">Baseline</div>
            <p className="mt-0.5 text-sm font-bold text-foreground">{snap ? snap.baselineScore.toFixed(3) : "--"}</p>
          </div>
          <div className="rounded border border-secondary/30 bg-secondary/5 px-2 py-1.5">
            <div className="text-secondary">Best</div>
            <p className="mt-0.5 text-sm font-bold text-secondary">{snap ? snap.bestScore.toFixed(3) : "--"}</p>
          </div>
          <div className="rounded border border-primary/30 bg-primary/5 px-2 py-1.5">
            <div className="text-primary">Trials</div>
            <p className="mt-0.5 text-sm font-bold text-primary">{snap?.totalExperiments ?? "--"}</p>
          </div>
          <div className="rounded border border-yellow-500/30 bg-yellow-500/5 px-2 py-1.5">
            <div className="text-yellow-400">Kept</div>
            <p className="mt-0.5 text-sm font-bold text-yellow-400">
              {snap ? `${snap.kept}/${snap.totalExperiments}` : "--"}
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
          <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5" title="Fraction of trials that improved the composite enough to be kept">
            <div className="text-muted-foreground">Kept rate</div>
            <p className="mt-0.5 text-xs font-bold text-foreground">{snap ? `${(snap.keptRate * 100).toFixed(1)}%` : "--"}</p>
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

        <div className="rounded border border-white/10 bg-black/30 p-2">
          <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase text-muted-foreground">
            <FlaskConical className="h-3 w-3 text-primary" />
            <span>Recent trials (newest first)</span>
          </div>
          <ScrollArea className="h-[160px]">
            <div className="space-y-0.5">
              {snap?.recentTrials.length ? snap.recentTrials.map((t) => (
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
              )) : (
                <p className="font-mono text-[10px] text-muted-foreground/70">No recent trial data yet.</p>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex items-center justify-between font-mono text-[8px] uppercase text-muted-foreground">
          <span>last trial {formatAge(snap?.lastExperimentAt ?? 0)}</span>
          <span>auto-refresh 30s</span>
        </div>
      </div>
    </DashboardCard>
  );
}
