"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertCircle,
  Brain,
  CircleDot,
  Cpu,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from "lucide-react";

type CircuitState = "closed" | "open" | "half_open" | "unknown";

type ProviderInfo = {
  name: string;
  priority?: number;
  has_api_key_env?: boolean;
};

type CapabilityEvidence = {
  capability: string;
  passes: number;
  fails: number;
};

type ModelEntry = {
  model_id: string;
  circuit_state: CircuitState;
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
  circuit_failure_count: number;
  circuit_success_count: number;
  circuit_opened_at: number;
  circuit_last_probe_at: number;
  rate_limit_recent_count: number;
  rate_limit_last_at: number;
  display_name?: string;
  context_window?: number;
  capabilities?: string[];
  providers?: ProviderInfo[];
  registry_known: boolean;
  capability_evidence?: CapabilityEvidence[];
  intel_last_probed_at?: number;
  last_probe_run_at?: number;
  // Richer error from agent session jsonl files. When set, surfaces the
  // actual prompt-error reason ("LLM idle timeout (120s): no response")
  // instead of the engine's class label ("timeout"). UI prefers this.
  session_last_error?: string;
  session_last_error_at?: number;
  session_last_error_provider?: string;
};

type ProbeJudgeStat = {
  capability: string;
  passes: number;
  fails: number;
  models_with_evidence: number;
};

type EngineSnapshot = {
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

type ScoreBreakdown = {
  model_id: string;
  total_score?: number;
  capability_score?: number;
  stability_score?: number;
  cost_score?: number;
  context_score?: number;
  speed_score?: number;
  provider_affinity_score?: number;
  circuit_state?: string;
};

type AgentPick = {
  agent: string;
  model_id: string | null;
  context_window?: number;
  capabilities?: string[];
  best_provider?: string;
  circuit_state?: string;
  alternates?: ScoreBreakdown[];
  error?: string;
};

function formatCooldown(seconds: number) {
  if (seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function shortModelId(modelId: string) {
  const slash = modelId.indexOf("/");
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

function formatContext(window?: number) {
  if (!window || window <= 0) return null;
  if (window >= 1_000_000) return `${(window / 1_000_000).toFixed(1)}M`;
  if (window >= 1000) return `${Math.round(window / 1000)}K`;
  return `${window}`;
}

function formatRelativeSeconds(epochSeconds: number) {
  if (!epochSeconds || epochSeconds <= 0) return null;
  const delta = Date.now() / 1000 - epochSeconds;
  if (delta < 0) return "soon";
  if (delta < 60) return `${Math.round(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function stateLabel(state: CircuitState, cooldownClass?: string) {
  if (cooldownClass === "decommissioned") return "DEAD";
  if (state === "open") return "BLOCKED";
  if (state === "half_open") return "PROBING";
  if (state === "closed") return "OK";
  return "?";
}

function stateColor(state: CircuitState, cooldownClass?: string) {
  if (cooldownClass === "decommissioned") return "border-zinc-500/40 text-zinc-400 bg-zinc-500/5";
  if (state === "open") return "border-destructive/40 text-destructive bg-destructive/5";
  if (state === "half_open") return "border-yellow-500/40 text-yellow-400 bg-yellow-500/5";
  if (state === "closed") return "border-secondary/30 text-secondary bg-secondary/5";
  return "border-white/10 text-muted-foreground bg-black/20";
}

export function SmartFallback() {
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [picks, setPicks] = useState<AgentPick[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"watchlist" | "all" | "decommissioned">("watchlist");
  const [busyModel, setBusyModel] = useState<string | null>(null);
  const [reprobing, setReprobing] = useState(false);
  const [reprobeResult, setReprobeResult] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/council/fallback/snapshot", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setError(typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
        return;
      }
      setSnapshot(data.snapshot as EngineSnapshot);
      setPicks(Array.isArray(data.picks) ? data.picks : []);
      setError(null);
    } catch (refreshError: any) {
      setError(refreshError?.message || "Smart Fallback fetch failed.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(true), 20000);
    return () => clearInterval(interval);
  }, [refresh]);

  const reprobeBlocked = async () => {
    if (reprobing) return;
    setReprobing(true);
    setReprobeResult("Reprobing — this can take a few minutes for many models…");
    try {
      const response = await fetch("/api/council/fallback/reprobe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setReprobeResult(data?.error || `Reprobe failed (HTTP ${response.status})`);
      } else {
        setReprobeResult(`Reprobed ${data.attempted}: ${data.passed} passed, ${data.failed} failed`);
        await refresh(true);
      }
    } catch (reprobeError: any) {
      setReprobeResult(reprobeError?.message || "Reprobe request failed");
    } finally {
      setReprobing(false);
      setTimeout(() => setReprobeResult(null), 8000);
    }
  };

  const resetCircuit = async (modelId: string) => {
    setBusyModel(modelId);
    try {
      const response = await fetch("/api/council/fallback/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setError(typeof data.error === "string" ? data.error : "Reset failed");
      } else {
        await refresh(true);
      }
    } catch (resetError: any) {
      setError(resetError?.message || "Reset failed");
    } finally {
      setBusyModel(null);
    }
  };

  const visibleModels = useMemo(() => {
    if (!snapshot) return [];
    if (filter === "decommissioned") {
      return snapshot.models.filter((entry) => entry.cooldown_class === "decommissioned");
    }
    // Both watchlist + all exclude decommissioned — they live in their own tab so they don't
    // pollute the active routing view. Watchlist also drops healthy models.
    const active = snapshot.models.filter((entry) => entry.cooldown_class !== "decommissioned");
    if (filter === "all") return active;
    return active.filter((entry) => entry.circuit_state !== "closed");
  }, [snapshot, filter]);

  const engineLive = Boolean(snapshot?.engineAvailable);
  // Watchlist count = anything that isn't healthy AND isn't decommissioned (those are parked).
  const watchlistCount = snapshot
    ? snapshot.totalModels - snapshot.healthy - snapshot.decommissioned
    : 0;
  const activeTotal = snapshot ? snapshot.totalModels - snapshot.decommissioned : 0;

  return (
    <DashboardCard
      title="Smart Fallback"
      subtitle="Model Routing v5"
      headerAction={
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase",
              engineLive ? "border-secondary/40 text-secondary" : "border-destructive/40 text-destructive"
            )}
            title={snapshot ? `Source: ${snapshot.source}` : ""}
          >
            {engineLive ? "engine live" : "engine offline"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 border-white/10 bg-transparent p-0 hover:bg-white/5"
            onClick={() => void refresh()}
            disabled={loading}
            title="Refresh smart fallback state"
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
            <div className="flex items-center gap-1 text-muted-foreground">
              <Brain className="h-3 w-3 text-primary" /> Total
            </div>
            <p className="mt-0.5 text-sm font-bold text-foreground">{snapshot?.totalModels ?? "--"}</p>
          </div>
          <div className="rounded border border-secondary/30 bg-secondary/5 px-2 py-1.5">
            <div className="flex items-center gap-1 text-secondary">
              <ShieldCheck className="h-3 w-3" /> Healthy
            </div>
            <p className="mt-0.5 text-sm font-bold text-secondary">{snapshot?.healthy ?? "--"}</p>
          </div>
          <div className="rounded border border-yellow-500/30 bg-yellow-500/5 px-2 py-1.5">
            <div className="flex items-center gap-1 text-yellow-400">
              <CircleDot className="h-3 w-3" /> Probing
            </div>
            <p className="mt-0.5 text-sm font-bold text-yellow-400">{snapshot?.recovering ?? "--"}</p>
          </div>
          <div className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5">
            <div className="flex items-center gap-1 text-destructive">
              <TriangleAlert className="h-3 w-3" /> Blocked
            </div>
            <p className="mt-0.5 text-sm font-bold text-destructive">{snapshot?.blocked ?? "--"}</p>
          </div>
        </div>

        <div className="rounded border border-white/10 bg-black/20 p-2">
          <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase text-muted-foreground">
            <Zap className="h-3 w-3 text-primary" />
            <span>Current picks</span>
          </div>
          <div className="space-y-1.5">
            {picks.length === 0 ? (
              <p className="font-mono text-[10px] text-muted-foreground/70">
                {engineLive ? "Engine returning no picks yet." : "Engine unavailable. Bring up WSL + smart-fallback-v5 to see live picks."}
              </p>
            ) : picks.map((pick) => (
              <div key={pick.agent} className="space-y-0.5 font-mono text-[10px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="w-16 shrink-0 uppercase text-primary/80">{pick.agent}</span>
                  {pick.model_id ? (
                    <span className="flex-1 truncate text-slate-200" title={`${pick.model_id}${pick.best_provider ? ` via ${pick.best_provider}` : ""}`}>
                      {shortModelId(pick.model_id)}
                      {pick.best_provider && (
                        <span className="ml-1 text-[8px] uppercase text-muted-foreground/60">via {pick.best_provider}</span>
                      )}
                    </span>
                  ) : (
                    <span className="flex-1 truncate text-destructive/80" title={pick.error}>
                      {pick.error || "no pick"}
                    </span>
                  )}
                  {pick.circuit_state && pick.circuit_state !== "closed" && (
                    <span className="rounded border border-yellow-500/30 px-1 text-[8px] uppercase text-yellow-400">
                      {pick.circuit_state.replace("_", "-")}
                    </span>
                  )}
                </div>
                {pick.alternates && pick.alternates.length > 1 && (
                  <div className="ml-16 space-y-0.5 border-l border-white/10 pl-2">
                    {pick.alternates.slice(1).map((alt) => {
                      const parts: string[] = [];
                      if (typeof alt.capability_score === "number") parts.push(`cap ${Math.round(alt.capability_score)}`);
                      if (typeof alt.stability_score === "number") parts.push(`stab ${Math.round(alt.stability_score)}`);
                      if (typeof alt.cost_score === "number") parts.push(`cost ${Math.round(alt.cost_score)}`);
                      if (typeof alt.context_score === "number") parts.push(`ctx ${Math.round(alt.context_score)}`);
                      return (
                        <div key={alt.model_id} className="flex items-center gap-2 text-[9px] text-muted-foreground/70" title={parts.join(" · ")}>
                          <span className="truncate text-muted-foreground/80">↳ {shortModelId(alt.model_id)}</span>
                          {typeof alt.total_score === "number" && (
                            <span className="shrink-0 text-[8px] uppercase">score {Math.round(alt.total_score)}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {snapshot && (snapshot.probeJudges?.length > 0 || picks.some((p) => p.alternates && p.alternates.length > 0)) && (
          <div className="rounded border border-white/10 bg-black/20 p-2">
            <div className="mb-1.5 flex items-center gap-1 font-mono text-[9px] uppercase text-muted-foreground">
              <ShieldCheck className="h-3 w-3 text-secondary" />
              <span>Judges</span>
              <span
                className="ml-auto cursor-help text-[8px] text-muted-foreground/60"
                title="Smart Fallback uses two judge layers: routing judges (6 weighted criteria that pick which model an agent gets) and probe judges (math/json/instruct content tests that produce capability evidence). Evidence feeds back into the capability score on every re-probe."
              >
                what is this?
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 font-mono text-[8px] uppercase text-muted-foreground/70">Routing judges (per pick)</p>
                <div className="space-y-0.5 font-mono text-[9px]">
                  {[
                    { key: "capability", label: "Capability fit", tip: "How well the model's tags match the agent's preferred capabilities + capability_evidence from probes." },
                    { key: "stability",  label: "Stability",      tip: "Rolling success rate + cooldown state. Drops when the circuit trips, recovers as probes pass." },
                    { key: "cost",       label: "Cost tier",      tip: "Free providers score 100, paid providers score lower so passes 1-2 stay free." },
                    { key: "context",    label: "Context window", tip: "Fraction of the agent's context_min_soft the model can hold." },
                    { key: "speed",      label: "Speed",          tip: "Latency-based score from EWMA of recent calls." },
                    { key: "provider_affinity", label: "Provider affinity", tip: "Bonus for providers the agent prefers in its profile." },
                  ].map((j) => (
                    <div key={j.key} className="flex items-center justify-between gap-2" title={j.tip}>
                      <span className="truncate text-muted-foreground/80">{j.label}</span>
                      <span className="shrink-0 text-[8px] uppercase text-muted-foreground/60">routing</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 font-mono text-[8px] uppercase text-muted-foreground/70">Probe judges (rolling pass-rate)</p>
                <div className="space-y-0.5 font-mono text-[9px]">
                  {snapshot.probeJudges.length === 0 ? (
                    <p className="text-muted-foreground/60">No probe evidence yet — run the probe sweep.</p>
                  ) : snapshot.probeJudges.slice(0, 6).map((judge) => {
                    const total = judge.passes + judge.fails;
                    const rate = total > 0 ? judge.passes / total : 0;
                    const tone = rate >= 0.7 ? "text-secondary" : rate >= 0.4 ? "text-yellow-400/80" : "text-destructive/80";
                    return (
                      <div
                        key={judge.capability}
                        className="flex items-center justify-between gap-2"
                        title={`${judge.passes} pass · ${judge.fails} fail across ${judge.models_with_evidence} models`}
                      >
                        <span className="truncate text-muted-foreground/80">{judge.capability}</span>
                        <span className={cn("shrink-0 font-mono text-[8px] uppercase", tone)}>
                          {judge.passes}/{total} ({Math.round(rate * 100)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded border border-white/10 bg-black/20 p-1">
            <button
              type="button"
              onClick={() => setFilter("watchlist")}
              className={cn(
                "rounded px-2 py-0.5 font-mono text-[9px] uppercase",
                filter === "watchlist" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-slate-100"
              )}
              title="Models recovering or blocked (excludes decommissioned and healthy)"
            >
              Watchlist ({watchlistCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(
                "rounded px-2 py-0.5 font-mono text-[9px] uppercase",
                filter === "all" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-slate-100"
              )}
              title="Every actively-routed model (excludes decommissioned)"
            >
              Active ({activeTotal})
            </button>
            <button
              type="button"
              onClick={() => setFilter("decommissioned")}
              className={cn(
                "rounded px-2 py-0.5 font-mono text-[9px] uppercase",
                filter === "decommissioned" ? "bg-zinc-500/20 text-zinc-300" : "text-muted-foreground hover:bg-white/5 hover:text-slate-100"
              )}
              title="Models with retired/deprecated provider endpoints — parked permanently with reason kept on record"
            >
              Decommissioned ({snapshot?.decommissioned ?? 0})
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 border-white/10 bg-transparent px-2 py-0 font-mono text-[9px] uppercase hover:bg-white/5"
              onClick={() => void reprobeBlocked()}
              disabled={reprobing || !engineLive}
              title="Reset every missing-env / timeout model and re-run the engine probe. Slow — can take several minutes."
            >
              {reprobing ? <RefreshCcw className="mr-1 h-3 w-3 animate-spin" /> : <Activity className="mr-1 h-3 w-3" />}
              {reprobing ? "Reprobing…" : "Reprobe blocked"}
            </Button>
            <span className="font-mono text-[8px] uppercase text-muted-foreground/70">
              {snapshot ? `updated ${formatCooldown((Date.now() - snapshot.generatedAt) / 1000)} ago` : ""}
            </span>
          </div>
        </div>
        {reprobeResult && (
          <div className="rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[9px] uppercase text-muted-foreground">
            {reprobeResult}
          </div>
        )}

        <ScrollArea className="h-[340px] rounded border border-white/10 bg-black/30 p-2">
          <div className="space-y-1">
            {visibleModels.length === 0 ? (
              <div className="flex items-center gap-2 rounded border border-white/10 bg-black/20 p-2 font-mono text-[10px] text-muted-foreground">
                <Activity className="h-3 w-3 text-secondary" />
                {filter === "watchlist"
                  ? "All tracked models healthy."
                  : filter === "decommissioned"
                    ? "No decommissioned models on record."
                    : engineLive ? "No models tracked yet." : "Engine offline — no data to show."}
              </div>
            ) : (
              visibleModels.map((entry) => {
                const decommissioned = entry.cooldown_class === "decommissioned";
                const contextLabel = formatContext(entry.context_window);
                const bestProvider = entry.providers && entry.providers.length > 0
                  ? [...entry.providers].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
                  : null;
                const lastProbe = formatRelativeSeconds(entry.circuit_last_probe_at || entry.intel_last_probed_at || entry.last_probe_run_at || 0);
                const recoveringProgress = entry.circuit_state === "half_open"
                  ? `${entry.circuit_success_count}/${Math.max(entry.circuit_success_count + entry.circuit_failure_count, 1)} probes`
                  : null;
                const evidenceFail = (entry.capability_evidence || []).some((ev) => ev.fails > ev.passes);
                return (
                <div
                  key={entry.model_id}
                  className={cn(
                    "flex items-start gap-2 rounded border px-2 py-1 font-mono text-[10px]",
                    entry.circuit_state === "open" ? "border-destructive/30 bg-destructive/5"
                      : entry.circuit_state === "half_open" ? "border-yellow-500/20 bg-yellow-500/5"
                      : "border-white/10 bg-white/[0.02]"
                  )}
                >
                  <span
                    className={cn("mt-0.5 shrink-0 rounded border px-1 text-[8px] uppercase", stateColor(entry.circuit_state, entry.cooldown_class))}
                    title={`circuit=${entry.circuit_state} class=${entry.cooldown_class}${entry.circuit_opened_at ? ` · opened ${formatRelativeSeconds(entry.circuit_opened_at) || "?"}` : ""}`}
                  >
                    {stateLabel(entry.circuit_state, entry.cooldown_class)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="min-w-0 flex-1 truncate text-slate-200" title={`${entry.display_name ? `${entry.display_name} · ` : ""}${entry.model_id}`}>
                        {entry.display_name || shortModelId(entry.model_id)}
                      </p>
                      {contextLabel && (
                        <span
                          className="shrink-0 rounded border border-primary/20 bg-primary/5 px-1 text-[8px] uppercase text-primary/80"
                          title={`Context window: ${entry.context_window} tokens`}
                        >
                          {contextLabel}
                        </span>
                      )}
                      {!entry.registry_known && (
                        <span
                          className="shrink-0 rounded border border-yellow-500/30 bg-yellow-500/5 px-1 text-[8px] uppercase text-yellow-400/80"
                          title="Model has health data but no registry entry — orphaned."
                        >
                          orphan
                        </span>
                      )}
                      {entry.rate_limit_recent_count > 0 && (
                        <span
                          className="shrink-0 rounded border border-orange-500/30 bg-orange-500/5 px-1 text-[8px] uppercase text-orange-400/80"
                          title={`${entry.rate_limit_recent_count} rate-limit events in the last hour`}
                        >
                          {entry.rate_limit_recent_count}× 429/hr
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[8px] uppercase text-muted-foreground/70">
                      score {Math.round(entry.score)}
                      {entry.consecutive_failures > 0 && !decommissioned && ` · ${entry.consecutive_failures} fail`}
                      {entry.total_rate_limits > 0 && ` · ${entry.total_rate_limits} 429`}
                      {entry.total_quota_exhaustions > 0 && ` · ${entry.total_quota_exhaustions} quota`}
                      {entry.avg_latency_ms > 0 && ` · ${Math.round(entry.avg_latency_ms)}ms`}
                      {!decommissioned && entry.cooldown_remaining > 0 && ` · ${formatCooldown(entry.cooldown_remaining)} cooldown`}
                      {decommissioned && ` · permanent block`}
                      {recoveringProgress && ` · ${recoveringProgress}`}
                    </p>
                    {(entry.capabilities?.length || bestProvider || lastProbe) && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {entry.capabilities?.slice(0, 4).map((cap) => (
                          <span
                            key={cap}
                            className={cn(
                              "rounded border px-1 text-[8px] uppercase",
                              evidenceFail && entry.capability_evidence?.find((ev) => ev.capability === cap && ev.fails > ev.passes)
                                ? "border-destructive/30 bg-destructive/5 text-destructive/80"
                                : "border-white/10 bg-white/5 text-muted-foreground/80"
                            )}
                            title={(() => {
                              const ev = entry.capability_evidence?.find((e) => e.capability === cap);
                              return ev ? `Probe evidence: ${ev.passes} pass · ${ev.fails} fail` : cap;
                            })()}
                          >
                            {cap}
                          </span>
                        ))}
                        {bestProvider && (
                          <span
                            className="rounded border border-secondary/20 bg-secondary/5 px-1 text-[8px] uppercase text-secondary/80"
                            title={`Provider${typeof bestProvider.priority === "number" ? ` · priority ${bestProvider.priority}` : ""}${bestProvider.has_api_key_env === false ? " · no API key configured" : ""}`}
                          >
                            via {bestProvider.name}{bestProvider.has_api_key_env === false ? " (no key)" : ""}
                          </span>
                        )}
                        {lastProbe && (
                          <span className="text-[8px] uppercase text-muted-foreground/60">
                            probed {lastProbe}
                          </span>
                        )}
                      </div>
                    )}
                    {entry.last_error && (entry.circuit_state === "open" || entry.circuit_state === "half_open") && (
                      <p className="mt-0.5 truncate text-[8px] text-destructive/70" title={entry.last_error}>
                        ⚠ {entry.last_error}
                      </p>
                    )}
                    {/* Richer session error — when present, surface the actual
                        prompt-error reason from agent session files. Shows beneath
                        the engine's class label so operators see both "timeout"
                        (the classification) and "LLM idle timeout (120s)" (the
                        actual reason). Includes provider + age so it's clear
                        which provider returned which error when. */}
                    {entry.session_last_error && (() => {
                      // session_last_error_at is unix ms; formatRelativeSeconds takes seconds.
                      const ageLabel = entry.session_last_error_at
                        ? formatRelativeSeconds(entry.session_last_error_at / 1000)
                        : null;
                      return (
                        <p
                          className="mt-0.5 truncate text-[8px] text-destructive/85"
                          title={`Session error${entry.session_last_error_provider ? ` from ${entry.session_last_error_provider}` : ""}${ageLabel ? ` (${ageLabel})` : ""}: ${entry.session_last_error}`}
                        >
                          <span className="opacity-60">
                            {entry.session_last_error_provider ? `${entry.session_last_error_provider} ` : ""}
                            {ageLabel ? `${ageLabel}: ` : ""}
                          </span>
                          {entry.session_last_error}
                        </p>
                      );
                    })()}
                  </div>
                  {(entry.circuit_state === "open" || entry.circuit_state === "half_open") && !decommissioned && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:bg-white/5 hover:text-primary"
                      onClick={() => void resetCircuit(entry.model_id)}
                      disabled={busyModel === entry.model_id}
                      title="Reset circuit + clear cooldown"
                    >
                      {busyModel === entry.model_id ? (
                        <RefreshCcw className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between font-mono text-[8px] uppercase text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Cpu className="h-3 w-3 text-primary/70" />
            <span>v5 engine · {snapshot?.totalModels ?? 0} models</span>
            {snapshot?.registryAvailable && (
              <span
                className="rounded border border-white/10 bg-white/[0.03] px-1 text-[8px]"
                title={`Registry: ${snapshot.registryModelCount} models${snapshot.registryBuiltAt ? ` · built ${snapshot.registryBuiltAt}` : ""}`}
              >
                reg {snapshot.registryModelCount}
              </span>
            )}
            {snapshot?.intelAvailable && (
              <span
                className="rounded border border-white/10 bg-white/[0.03] px-1 text-[8px]"
                title="Capability evidence loaded from probe runs"
              >
                intel
              </span>
            )}
            {snapshot && snapshot.rateLimitedRecently > 0 && (
              <span
                className="rounded border border-orange-500/30 bg-orange-500/5 px-1 text-[8px] text-orange-400/80"
                title="Models that hit a rate limit within the last hour"
              >
                {snapshot.rateLimitedRecently}× hot
              </span>
            )}
          </span>
          <span>auto-refresh 20s</span>
        </div>
      </div>
    </DashboardCard>
  );
}
