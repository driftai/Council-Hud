"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AlertCircle, RefreshCcw, ShieldCheck, ListChecks } from "lucide-react";

type Level = "info" | "warn" | "error" | "ok";

type Entry = {
  source: string;
  ts: number;
  level: Level;
  message: string;
};

type SourceStat = {
  source: string;
  entries: number;
  lastTs: number;
  level: Level;
};

type Snapshot = {
  available: boolean;
  totalLogs: number;
  activeLogs: number;
  entries: Entry[];
  lastActivity: number;
  bySource: SourceStat[];
  source: string;
};

function formatAge(epochSeconds: number) {
  if (!epochSeconds || epochSeconds <= 0) return "—";
  const delta = Date.now() / 1000 - epochSeconds;
  if (delta < 0) return "now";
  if (delta < 60) return `${Math.round(delta)}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

const LEVEL_TONE: Record<Level, string> = {
  ok: "border-secondary/30 bg-secondary/5 text-secondary",
  info: "border-white/10 bg-white/[0.02] text-muted-foreground/90",
  warn: "border-yellow-500/30 bg-yellow-500/5 text-yellow-300/90",
  error: "border-destructive/40 bg-destructive/5 text-destructive/90",
};

export function AuditTrail() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Level | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetch("/api/council/audit-trail", { cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(typeof data.error === "string" ? data.error : `HTTP ${r.status}`);
        return;
      }
      setSnap(data.snapshot as Snapshot);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Audit fetch failed");
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
  const entries = snap?.entries ?? [];
  const visible = entries.filter((e) => {
    if (filter !== "all" && e.level !== filter) return false;
    if (sourceFilter && e.source !== sourceFilter) return false;
    return true;
  });

  const counts: Record<Level, number> = { ok: 0, info: 0, warn: 0, error: 0 };
  for (const e of entries) counts[e.level] = (counts[e.level] || 0) + 1;

  return (
    <DashboardCard
      title="Audit Trail"
      subtitle="Background Audit Workers"
      headerAction={
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase",
              available ? "border-secondary/40 text-secondary" : "border-destructive/40 text-destructive"
            )}
            title={snap ? `${snap.activeLogs}/${snap.totalLogs} log files active in last 24h` : ""}
          >
            {available ? `${snap?.activeLogs ?? 0}/${snap?.totalLogs ?? 0} active` : "audits offline"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 border-white/10 bg-transparent p-0 hover:bg-white/5"
            onClick={() => void refresh()}
            disabled={loading}
            title="Re-tail audit logs"
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
          {(["ok", "info", "warn", "error"] as Level[]).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setFilter(filter === lvl ? "all" : lvl)}
              className={cn(
                "rounded border px-2 py-1.5 text-left",
                LEVEL_TONE[lvl],
                filter === lvl && "ring-1 ring-primary/40"
              )}
              title={`Filter to ${lvl} only`}
            >
              <div className="text-muted-foreground/80">{lvl}</div>
              <p className="mt-0.5 text-sm font-bold">{counts[lvl] ?? 0}</p>
            </button>
          ))}
        </div>

        <div className="rounded border border-white/10 bg-black/20 p-2">
          <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-secondary/80" />
            <span>Sources ({snap?.bySource.length ?? 0})</span>
            {sourceFilter && (
              <button
                type="button"
                className="ml-auto rounded border border-white/10 px-1 text-[8px] hover:bg-white/5"
                onClick={() => setSourceFilter(null)}
              >
                clear filter
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {snap?.bySource.map((s) => (
              <button
                key={s.source}
                type="button"
                onClick={() => setSourceFilter(sourceFilter === s.source ? null : s.source)}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[8px]",
                  LEVEL_TONE[s.level],
                  sourceFilter === s.source && "ring-1 ring-primary/50"
                )}
                title={`${s.entries} entries · last ${formatAge(s.lastTs)} ago`}
              >
                {s.source.replace(/\.log$/, "")}
                <span className="ml-1 opacity-60">{formatAge(s.lastTs)}</span>
              </button>
            ))}
            {(!snap?.bySource || snap.bySource.length === 0) && (
              <span className="font-mono text-[10px] text-muted-foreground/70">No audit log sources found.</span>
            )}
          </div>
        </div>

        <ScrollArea className="h-[260px] rounded border border-white/10 bg-black/30 p-2">
          <div className="space-y-1">
            {visible.length === 0 ? (
              <div className="flex items-center gap-2 rounded border border-white/10 bg-black/20 p-2 font-mono text-[10px] text-muted-foreground">
                <ListChecks className="h-3 w-3 text-secondary" />
                {filter === "all" && !sourceFilter
                  ? available ? "No audit lines tailed yet." : "No audit workers reachable."
                  : "No entries match the current filter."}
              </div>
            ) : visible.map((e, i) => (
              <div
                key={`${e.source}-${i}-${e.ts}`}
                className={cn("rounded border px-2 py-1 font-mono text-[9px]", LEVEL_TONE[e.level])}
              >
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 rounded border border-white/10 px-1 text-[8px] uppercase opacity-70">
                    {e.level}
                  </span>
                  <span className="shrink-0 text-[8px] uppercase opacity-60" title={new Date(e.ts * 1000).toISOString()}>
                    {e.source.replace(/\.log$/, "")} · {formatAge(e.ts)}
                  </span>
                </div>
                <p className="mt-0.5 break-words text-[9px] opacity-90" title={e.message}>
                  {e.message}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between font-mono text-[8px] uppercase text-muted-foreground">
          <span>last activity {snap ? formatAge(snap.lastActivity / 1000) : "—"} ago</span>
          <span>auto-refresh 30s</span>
        </div>
      </div>
    </DashboardCard>
  );
}
