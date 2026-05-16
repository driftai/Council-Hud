"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNexus } from "@/providers/NexusProvider";
import { DashboardCard } from "./DashboardCard";
import {
  Terminal, Cpu, FileJson, Brain, Zap, Trash2, FileText, Code, Sparkles, Copy, Check,
  Network, Server, ShieldCheck, AlertCircle, RefreshCcw, ListChecks,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getNexusLogLabel, getNexusLogSignal, summarizeNexusPayload } from "@/lib/nexus/logging";

// =============================================================================
// Types
// =============================================================================

const TYPE_ICONS: Record<string, any> = {
  HARDWARE_PULSE: Cpu, PROCESS_GRAPH: Brain, FILE_READ: FileText, FILE_WRITE: Code,
  EXEC_OUTPUT: Terminal, HARDWARE: Cpu, FILESYSTEM: FileJson, COGNITIVE_LOG: Brain,
  FILESYSTEM_TREE: Zap, FILE_CONTENT: FileText, COMMAND: Terminal, NEURAL: Sparkles,
};

const TYPE_COLORS: Record<string, string> = {
  HARDWARE_PULSE: "text-secondary", PROCESS_GRAPH: "text-green-400",
  FILE_READ: "text-yellow-400", FILE_WRITE: "text-orange-400",
  EXEC_OUTPUT: "text-purple-400", HARDWARE: "text-secondary",
  FILESYSTEM: "text-primary", COGNITIVE_LOG: "text-purple-400",
  FILESYSTEM_TREE: "text-cyan-400", FILE_CONTENT: "text-yellow-400",
  COMMAND: "text-orange-400", NEURAL: "text-primary",
  GENERIC: "text-muted-foreground",
};

type ServiceStatus = {
  unit: string;
  scope: "system" | "user";
  description: string;
  active: "active" | "inactive" | "failed" | "activating" | "deactivating" | "unknown";
  sub: string;
  since: number;
  pid: number;
  memoryBytes: number;
  category: "gateway" | "router" | "tunnel" | "sentinel" | "other";
};

type ServicesSnapshot = {
  available: boolean;
  services: ServiceStatus[];
  generatedAt: number;
};

const CATEGORY_ICON: Record<ServiceStatus["category"], any> = {
  gateway: Network,
  router: Server,
  tunnel: Zap,
  sentinel: ShieldCheck,
  other: Cpu,
};

type AuditLevel = "info" | "warn" | "error" | "ok";

type AuditEntry = {
  source: string;
  ts: number;
  level: AuditLevel;
  message: string;
};

type AuditSourceStat = {
  source: string;
  entries: number;
  lastTs: number;
  level: AuditLevel;
};

type AuditSnapshot = {
  available: boolean;
  totalLogs: number;
  activeLogs: number;
  entries: AuditEntry[];
  lastActivity: number;
  bySource: AuditSourceStat[];
  source: string;
};

const LEVEL_TONE: Record<AuditLevel, string> = {
  ok: "border-secondary/30 bg-secondary/5 text-secondary",
  info: "border-white/10 bg-white/[0.02] text-muted-foreground/90",
  warn: "border-yellow-500/30 bg-yellow-500/5 text-yellow-300/90",
  error: "border-destructive/40 bg-destructive/5 text-destructive/90",
};

// =============================================================================
// Format helpers
// =============================================================================

function formatMemory(bytes: number) {
  if (!bytes) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}G`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)}M`;
  return `${(bytes / 1024).toFixed(0)}K`;
}

function formatUptime(epochMs: number) {
  if (!epochMs) return "—";
  const delta = (Date.now() - epochMs) / 1000;
  if (delta < 60) return `${Math.round(delta)}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

function formatAuditAge(epochSeconds: number) {
  if (!epochSeconds || epochSeconds <= 0) return "—";
  const delta = Date.now() / 1000 - epochSeconds;
  if (delta < 0) return "now";
  if (delta < 60) return `${Math.round(delta)}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

// =============================================================================
// Merged card — three tabs: Packets / Gateways / Audits.
// Was previously two cards (NexusLogs + AuditTrail). Consolidated 2026-05-16
// because all three feeds are log-shaped time-series and the operator wants
// them in one place instead of scattered.
// =============================================================================

type Tab = "packets" | "gateways" | "audits";

export function NexusLogs() {
  const { nexusLogs, state, clearLogs } = useNexus();
  const [tab, setTab] = useState<Tab>("packets");
  const [copied, setCopied] = useState(false);

  // Gateways
  const [services, setServices] = useState<ServicesSnapshot | null>(null);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);

  // Audits
  const [audits, setAudits] = useState<AuditSnapshot | null>(null);
  const [auditsLoading, setAuditsLoading] = useState(false);
  const [auditsError, setAuditsError] = useState<string | null>(null);
  const [auditLevelFilter, setAuditLevelFilter] = useState<AuditLevel | "all">("all");
  const [auditSourceFilter, setAuditSourceFilter] = useState<string | null>(null);

  const connected = state === "LINKED";

  const refreshServices = useCallback(async () => {
    setServicesLoading(true);
    try {
      const r = await fetch("/api/council/services", { cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setServicesError(typeof data.error === "string" ? data.error : `HTTP ${r.status}`);
        return;
      }
      setServices(data.snapshot as ServicesSnapshot);
      setServicesError(null);
    } catch (e: any) {
      setServicesError(e?.message || "Services fetch failed");
    } finally {
      setServicesLoading(false);
    }
  }, []);

  const refreshAudits = useCallback(async () => {
    setAuditsLoading(true);
    try {
      const r = await fetch("/api/council/audit-trail", { cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setAuditsError(typeof data.error === "string" ? data.error : `HTTP ${r.status}`);
        return;
      }
      setAudits(data.snapshot as AuditSnapshot);
      setAuditsError(null);
    } catch (e: any) {
      setAuditsError(e?.message || "Audit fetch failed");
    } finally {
      setAuditsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "gateways") return;
    void refreshServices();
    const t = setInterval(() => void refreshServices(), 30000);
    return () => clearInterval(t);
  }, [tab, refreshServices]);

  useEffect(() => {
    if (tab !== "audits") return;
    void refreshAudits();
    const t = setInterval(() => void refreshAudits(), 30000);
    return () => clearInterval(t);
  }, [tab, refreshAudits]);

  const handleCopyLogs = () => {
    if (nexusLogs.length === 0) return;
    const logText = nexusLogs.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      return `[${timestamp}] ${getNexusLogLabel(log.type)}: ${summarizeNexusPayload(log.payload, 160)}`;
    }).join('\n');
    navigator.clipboard.writeText(logText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const auditCount = audits?.entries.length ?? 0;
  const auditLevelCounts = useMemo(() => {
    const c: Record<AuditLevel, number> = { ok: 0, info: 0, warn: 0, error: 0 };
    for (const e of (audits?.entries ?? [])) c[e.level] = (c[e.level] || 0) + 1;
    return c;
  }, [audits]);
  const visibleAuditEntries = useMemo(() => {
    return (audits?.entries ?? []).filter((e) => {
      if (auditLevelFilter !== "all" && e.level !== auditLevelFilter) return false;
      if (auditSourceFilter && e.source !== auditSourceFilter) return false;
      return true;
    });
  }, [audits, auditLevelFilter, auditSourceFilter]);

  return (
    <DashboardCard
      title="Nexus Logs"
      subtitle="Packets · Gateways · Audits"
      headerAction={
        <div className="flex items-center gap-3">
          {tab === "packets" && (
            <>
              <button
                onClick={clearLogs}
                disabled={nexusLogs.length === 0}
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-white/10 bg-white/5 hover:bg-white/10 transition-all group disabled:opacity-30 disabled:cursor-not-allowed text-muted-foreground hover:text-destructive"
                title="Clear all logs"
              >
                <Trash2 className="w-3 h-3 group-hover:scale-110 transition-transform" />
                <span className="text-[9px] font-mono font-bold uppercase">Clear</span>
              </button>
              <button
                onClick={handleCopyLogs}
                disabled={nexusLogs.length === 0}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded border border-white/10 bg-white/5 hover:bg-white/10 transition-all group disabled:opacity-30 disabled:cursor-not-allowed",
                  copied ? "text-secondary border-secondary/30" : "text-muted-foreground hover:text-primary"
                )}
                title="Copy all logs"
              >
                {copied ? <><Check className="w-3 h-3" /><span className="text-[9px] font-mono font-bold uppercase">Copied</span></>
                        : <><Copy className="w-3 h-3 group-hover:scale-110 transition-transform" /><span className="text-[9px] font-mono font-bold uppercase">Copy</span></>}
              </button>
            </>
          )}
          {tab === "gateways" && (
            <button
              onClick={() => void refreshServices()}
              disabled={servicesLoading}
              className="flex items-center gap-1.5 px-2 py-1 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-primary transition-all disabled:opacity-30"
              title="Re-poll systemd"
            >
              <RefreshCcw className={cn("w-3 h-3", servicesLoading && "animate-spin")} />
              <span className="text-[9px] font-mono font-bold uppercase">Poll</span>
            </button>
          )}
          {tab === "audits" && (
            <button
              onClick={() => void refreshAudits()}
              disabled={auditsLoading}
              className="flex items-center gap-1.5 px-2 py-1 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-primary transition-all disabled:opacity-30"
              title="Re-tail audit logs"
            >
              <RefreshCcw className={cn("w-3 h-3", auditsLoading && "animate-spin")} />
              <span className="text-[9px] font-mono font-bold uppercase">Tail</span>
            </button>
          )}
          <Terminal className={cn("w-4 h-4", connected ? "text-primary animate-pulse" : "text-muted-foreground")} />
        </div>
      }
    >
      <div className="mb-2 flex items-center gap-1 rounded border border-white/10 bg-black/20 p-1">
        <button
          type="button"
          onClick={() => setTab("packets")}
          className={cn(
            "flex-1 rounded px-2 py-1 font-mono text-[9px] uppercase transition-colors",
            tab === "packets" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5"
          )}
        >
          Packets ({nexusLogs.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("gateways")}
          className={cn(
            "flex-1 rounded px-2 py-1 font-mono text-[9px] uppercase transition-colors",
            tab === "gateways" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5"
          )}
        >
          Gateways ({services?.services.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setTab("audits")}
          className={cn(
            "flex-1 rounded px-2 py-1 font-mono text-[9px] uppercase transition-colors",
            tab === "audits" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5"
          )}
        >
          Audits ({auditCount})
        </button>
      </div>

      {tab === "packets" && (
        <ScrollArea className="h-[320px] -mx-4 px-4">
          <div className="space-y-3 py-2">
            {nexusLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 opacity-20">
                <Terminal className="w-8 h-8 mb-2" />
                <p className="font-mono text-[9px] uppercase tracking-tighter">Awaiting Packets...</p>
              </div>
            ) : (
              nexusLogs.map((log, i) => {
                const Icon = TYPE_ICONS[log.type] || Terminal;
                const color = TYPE_COLORS[log.type] || TYPE_COLORS.GENERIC;
                const label = getNexusLogSignal(log.type);
                return (
                  <div key={i} className="flex gap-3 group animate-in fade-in slide-in-from-left-2 duration-300">
                    <div className={cn("mt-1 shrink-0", color)}>
                      <Icon className="w-3 h-3" />
                    </div>
                    <div className={cn("flex-1 min-w-0 font-mono text-[9px] border-l border-white/5 pl-3 transition-colors",
                      log.type === "COMMAND" || log.type === "NEURAL" ? "bg-primary/5" : "group-hover:border-primary/30"
                    )}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={cn("font-bold uppercase tracking-widest", color)}>{label}</span>
                        <span className="text-muted-foreground text-[8px]">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-foreground/80 break-words line-clamp-2 italic">
                        {summarizeNexusPayload(log.payload, 120)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      )}

      {tab === "gateways" && (
        <div className="space-y-2">
          {servicesError && (
            <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 font-mono text-[9px] uppercase text-destructive">
              <AlertCircle className="h-3 w-3" />
              <span className="truncate" title={servicesError}>{servicesError}</span>
            </div>
          )}
          <ScrollArea className="h-[300px]">
            <div className="space-y-1.5">
              {(!services || services.services.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-10 opacity-30">
                  <Server className="h-8 w-8 mb-2" />
                  <p className="font-mono text-[9px] uppercase tracking-tighter">
                    {servicesLoading ? "Polling systemd..." : "No autonomous workers reachable."}
                  </p>
                </div>
              ) : services.services.map((svc) => {
                const Icon = CATEGORY_ICON[svc.category];
                const tone =
                  svc.active === "active" ? "border-secondary/30 bg-secondary/5"
                  : svc.active === "failed" ? "border-destructive/40 bg-destructive/5"
                  : svc.active === "activating" ? "border-yellow-500/30 bg-yellow-500/5"
                  : "border-white/10 bg-white/[0.02]";
                const stateColor =
                  svc.active === "active" ? "text-secondary"
                  : svc.active === "failed" ? "text-destructive"
                  : svc.active === "activating" ? "text-yellow-400"
                  : "text-muted-foreground";
                return (
                  <div key={`${svc.scope}:${svc.unit}`} className={cn("rounded border p-2 font-mono text-[10px]", tone)}>
                    <div className="flex items-center gap-2">
                      <Icon className={cn("h-3 w-3", stateColor)} />
                      <span className="truncate font-bold text-slate-200" title={svc.description}>{svc.unit}</span>
                      <span className={cn("ml-auto rounded border border-white/10 px-1 text-[8px] uppercase", stateColor)}>
                        {svc.active}{svc.sub ? ` · ${svc.sub}` : ""}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[8px] uppercase text-muted-foreground/80">
                      <span>{svc.scope}</span>
                      {svc.pid > 0 && <span title="Main process PID">pid {svc.pid}</span>}
                      {svc.memoryBytes > 0 && <span title="Resident memory">{formatMemory(svc.memoryBytes)}</span>}
                      {svc.since > 0 && <span title={`Active since ${new Date(svc.since).toLocaleString()}`}>up {formatUptime(svc.since)}</span>}
                      <span className="opacity-60">·</span>
                      <span className="truncate text-muted-foreground/60" title={svc.description}>{svc.description}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      )}

      {tab === "audits" && (
        <div className="space-y-2">
          {auditsError && (
            <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 font-mono text-[9px] uppercase text-destructive">
              <AlertCircle className="h-3 w-3" />
              <span className="truncate" title={auditsError}>{auditsError}</span>
            </div>
          )}
          <div className="grid grid-cols-4 gap-2 font-mono text-[9px] uppercase">
            {(["ok", "info", "warn", "error"] as AuditLevel[]).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setAuditLevelFilter(auditLevelFilter === lvl ? "all" : lvl)}
                className={cn(
                  "rounded border px-2 py-1.5 text-left",
                  LEVEL_TONE[lvl],
                  auditLevelFilter === lvl && "ring-1 ring-primary/40"
                )}
                title={`Filter to ${lvl} only`}
              >
                <div className="text-muted-foreground/80">{lvl}</div>
                <p className="mt-0.5 text-sm font-bold">{auditLevelCounts[lvl] ?? 0}</p>
              </button>
            ))}
          </div>

          <div className="rounded border border-white/10 bg-black/20 p-2">
            <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase text-muted-foreground">
              <ShieldCheck className="h-3 w-3 text-secondary/80" />
              <span>Sources ({audits?.bySource.length ?? 0})</span>
              {auditSourceFilter && (
                <button
                  type="button"
                  className="ml-auto rounded border border-white/10 px-1 text-[8px] hover:bg-white/5"
                  onClick={() => setAuditSourceFilter(null)}
                >
                  clear filter
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {audits?.bySource.map((s) => (
                <button
                  key={s.source}
                  type="button"
                  onClick={() => setAuditSourceFilter(auditSourceFilter === s.source ? null : s.source)}
                  className={cn(
                    "rounded border px-1.5 py-0.5 font-mono text-[8px]",
                    LEVEL_TONE[s.level],
                    auditSourceFilter === s.source && "ring-1 ring-primary/50"
                  )}
                  title={`${s.entries} entries · last ${formatAuditAge(s.lastTs)} ago`}
                >
                  {s.source.replace(/\.log$/, "")}
                  <span className="ml-1 opacity-60">{formatAuditAge(s.lastTs)}</span>
                </button>
              ))}
              {(!audits?.bySource || audits.bySource.length === 0) && (
                <span className="font-mono text-[10px] text-muted-foreground/70">
                  {auditsLoading ? "Tailing audit logs..." : "No audit log sources found."}
                </span>
              )}
            </div>
          </div>

          <ScrollArea className="h-[240px] rounded border border-white/10 bg-black/30 p-2">
            <div className="space-y-1">
              {visibleAuditEntries.length === 0 ? (
                <div className="flex items-center gap-2 rounded border border-white/10 bg-black/20 p-2 font-mono text-[10px] text-muted-foreground">
                  <ListChecks className="h-3 w-3 text-secondary" />
                  {auditLevelFilter === "all" && !auditSourceFilter
                    ? audits?.available ? "No audit lines tailed yet." : "No audit workers reachable."
                    : "No entries match the current filter."}
                </div>
              ) : visibleAuditEntries.map((e, i) => (
                <div
                  key={`${e.source}-${i}-${e.ts}`}
                  className={cn("rounded border px-2 py-1 font-mono text-[9px]", LEVEL_TONE[e.level])}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 rounded border border-white/10 px-1 text-[8px] uppercase opacity-70">
                      {e.level}
                    </span>
                    <span className="shrink-0 text-[8px] uppercase opacity-60" title={new Date(e.ts * 1000).toISOString()}>
                      {e.source.replace(/\.log$/, "")} · {formatAuditAge(e.ts)}
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
            <span>{audits ? `${audits.activeLogs}/${audits.totalLogs} active 24h` : "—"}</span>
            <span>last activity {audits ? formatAuditAge(audits.lastActivity / 1000) : "—"} ago</span>
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
