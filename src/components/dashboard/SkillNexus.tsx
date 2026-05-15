"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Boxes,
  Brain,
  Cog,
  Database,
  Dna,
  FileWarning,
  Flame,
  GitBranch,
  Layers,
  Maximize2,
  Minimize2,
  Network,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

type SkillItemStatus =
  | "ok" | "stale" | "duplicate" | "conflicted" | "missing"
  | "oversized" | "error" | "pending" | "candidate" | "deprecated";

type SkillNexusItem = {
  id: string;
  name: string;
  description?: string;
  relativePath?: string;
  size?: number;
  mtime?: number;
  hash?: string;
  status?: SkillItemStatus;
  tags?: string[];
  meta?: Record<string, string | number | boolean>;
};

type DomainHealth = "ok" | "degraded" | "unreachable" | "disabled" | "unsupported" | "empty";

type DomainSnapshot = {
  id: string;
  label: string;
  type: string;
  enabled: boolean;
  health: DomainHealth;
  itemCount: number;
  problemCount: number;
  warnings: string[];
  items: SkillNexusItem[];
  generatedAt: number;
  meta?: Record<string, string | number | boolean>;
};

type SkillNexusReport = {
  ok: boolean;
  enabled: boolean;
  generatedAt: number;
  pollIntervalMs: number;
  totals: {
    domains: number;
    enabledDomains: number;
    healthyDomains: number;
    items: number;
    problems: number;
    warnings: number;
  };
  domains: DomainSnapshot[];
  unsupportedDomains: Array<{ id: string; label: string; type: string }>;
};

const DOMAIN_ICONS: Record<string, any> = {
  skillRoot: Layers,
  skillForge: Flame,
  skillEvolver: Dna,
  sessionMiner: Brain,
  reportFile: Database,
  projectDocs: GitBranch,
  syncStatus: Network,
  genericJson: Boxes,
};

const STATUS_TONE: Record<string, string> = {
  ok: "border-secondary/30 text-secondary bg-secondary/5",
  stale: "border-yellow-500/30 text-yellow-400 bg-yellow-500/5",
  duplicate: "border-orange-400/40 text-orange-300 bg-orange-500/5",
  conflicted: "border-destructive/40 text-destructive bg-destructive/5",
  missing: "border-destructive/40 text-destructive bg-destructive/5",
  oversized: "border-yellow-500/30 text-yellow-400 bg-yellow-500/5",
  error: "border-destructive/40 text-destructive bg-destructive/5",
  pending: "border-primary/30 text-primary bg-primary/5",
  candidate: "border-fuchsia-400/40 text-fuchsia-300 bg-fuchsia-500/5",
  deprecated: "border-muted-foreground/30 text-muted-foreground bg-muted/10",
};

const HEALTH_TONE: Record<DomainHealth, string> = {
  ok: "border-secondary/40 text-secondary",
  degraded: "border-yellow-500/40 text-yellow-400",
  unreachable: "border-destructive/40 text-destructive",
  disabled: "border-white/10 text-muted-foreground",
  unsupported: "border-orange-400/40 text-orange-300",
  empty: "border-white/10 text-muted-foreground",
};

function formatAgo(ts: number) {
  if (!ts) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10}KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10}MB`;
}

export function SkillNexus() {
  const [report, setReport] = useState<SkillNexusReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [statusFilter, setStatusFilter] = useState<"all" | "problems">("all");
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/council/skill-nexus", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setError(typeof data?.error === "string" ? data.error : "Skill Nexus fetch failed");
        return;
      }
      setReport(data as SkillNexusReport);
      setError(null);
    } catch (refreshError: any) {
      setError(refreshError?.message || "Skill Nexus fetch failed");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(true), Math.max(10000, report?.pollIntervalMs ?? 20000));
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  useEffect(() => {
    if (!expanded) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expanded]);

  const domains = report?.domains ?? [];
  const activeDomain = useMemo(() => {
    if (activeTab === "overview" || activeTab === "issues") return null;
    return domains.find((domain) => domain.id === activeTab) ?? null;
  }, [activeTab, domains]);

  const allWarnings = useMemo(() => {
    const out: Array<{ domainId: string; domainLabel: string; warning: string }> = [];
    for (const domain of domains) {
      for (const warning of domain.warnings) {
        out.push({ domainId: domain.id, domainLabel: domain.label, warning });
      }
    }
    return out;
  }, [domains]);

  const totals = report?.totals;

  return (
    <>
      {expanded && (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
          aria-hidden="true"
        />
      )}
      <DashboardCard
        title="Skill Nexus"
        subtitle="Domain Registry · Federated Skill Monitor"
        className={expanded ? "fixed inset-4 z-50 !min-h-0 shadow-2xl" : ""}
        headerAction={
          <div className="flex items-center gap-2">
            {report && (
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase",
                  totals && totals.problems === 0 && totals.warnings === 0
                    ? "border-secondary/40 text-secondary"
                    : totals && totals.problems > 0
                    ? "border-destructive/40 text-destructive"
                    : "border-yellow-500/40 text-yellow-400"
                )}
                title={`Generated ${formatAgo(report.generatedAt)}`}
              >
                {totals?.healthyDomains ?? 0}/{totals?.enabledDomains ?? 0} healthy
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7 border-white/10 bg-transparent p-0 hover:bg-white/5"
              onClick={() => void refresh()}
              disabled={loading}
              title="Refresh Skill Nexus"
            >
              <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-black/30 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
              title={expanded ? "Collapse (Esc)" : "Expand"}
              aria-label={expanded ? "Collapse Skill Nexus" : "Expand Skill Nexus"}
            >
              {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>
          </div>
        }
      >
        <div className={cn("flex flex-col gap-3", expanded ? "h-full" : "")}>
          {error && (
            <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 font-mono text-[9px] uppercase text-destructive">
              <AlertCircle className="h-3 w-3" />
              <span className="truncate" title={error}>{error}</span>
            </div>
          )}

          {/* === Tab strip === */}
          <div className="flex flex-wrap gap-1 rounded border border-white/10 bg-black/20 p-1">
            <TabButton
              active={activeTab === "overview"}
              onClick={() => setActiveTab("overview")}
              icon={Sparkles}
              label="Overview"
              count={domains.length}
            />
            {domains.map((domain) => (
              <TabButton
                key={domain.id}
                active={activeTab === domain.id}
                onClick={() => setActiveTab(domain.id)}
                icon={DOMAIN_ICONS[domain.type] || Cog}
                label={domain.label}
                count={domain.itemCount}
                tone={HEALTH_TONE[domain.health]}
                problem={domain.problemCount > 0}
              />
            ))}
            <TabButton
              active={activeTab === "issues"}
              onClick={() => setActiveTab("issues")}
              icon={TriangleAlert}
              label="Issues"
              count={(totals?.problems ?? 0) + (totals?.warnings ?? 0)}
              tone={totals && totals.problems > 0 ? HEALTH_TONE.unreachable : HEALTH_TONE.degraded}
            />
          </div>

          {/* === Tab content === */}
          <div className={cn("min-h-0 flex-1", expanded ? "overflow-hidden" : "")}>
            {activeTab === "overview" && (
              <OverviewPanel report={report} onJumpToDomain={setActiveTab} />
            )}
            {activeTab === "issues" && (
              <IssuesPanel report={report} warnings={allWarnings} onJumpToDomain={setActiveTab} />
            )}
            {activeDomain && (
              <DomainPanel
                domain={activeDomain}
                statusFilter={statusFilter}
                onStatusFilter={setStatusFilter}
                expanded={expanded}
              />
            )}
          </div>

          <div className="flex items-center justify-between font-mono text-[8px] uppercase text-muted-foreground">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-primary/70" />
              {report?.enabled ? "Local-only · paths redacted" : "Skill Nexus disabled in config"}
            </span>
            <span>auto-refresh {Math.round((report?.pollIntervalMs ?? 20000) / 1000)}s</span>
          </div>
        </div>
      </DashboardCard>
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  tone,
  problem,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
  count?: number;
  tone?: string;
  problem?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[9px] uppercase transition-colors",
        active
          ? "bg-primary/20 text-primary"
          : "text-muted-foreground hover:bg-white/5 hover:text-slate-100"
      )}
    >
      <Icon className={cn("h-3 w-3", problem && "text-yellow-400")} />
      <span>{label}</span>
      {typeof count === "number" && (
        <span className={cn("rounded border px-1 text-[8px]", tone || "border-white/10 text-muted-foreground/80")}>
          {count}
        </span>
      )}
    </button>
  );
}

function OverviewPanel({
  report,
  onJumpToDomain,
}: {
  report: SkillNexusReport | null;
  onJumpToDomain: (id: string) => void;
}) {
  if (!report) {
    return (
      <div className="rounded border border-white/10 bg-black/20 p-3 font-mono text-[10px] text-muted-foreground">
        Loading Skill Nexus snapshot…
      </div>
    );
  }
  if (!report.enabled) {
    return (
      <div className="rounded border border-white/10 bg-black/20 p-3 font-mono text-[10px] text-muted-foreground">
        Skill Nexus is disabled in the loaded config. Set <code className="text-primary">skillNexus.enabled = true</code> in <code className="text-primary">council.config.local.json</code>.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile icon={Layers} label="Domains" value={report.totals.domains} tone="text-primary" />
        <StatTile icon={ShieldCheck} label="Healthy" value={report.totals.healthyDomains} tone="text-secondary" />
        <StatTile icon={Boxes} label="Items" value={report.totals.items} tone="text-foreground" />
        <StatTile icon={TriangleAlert} label="Problems" value={report.totals.problems} tone="text-destructive" />
      </div>

      <ScrollArea className="h-[260px] rounded border border-white/10 bg-black/30 p-2">
        <div className="space-y-2">
          {report.domains.map((domain) => {
            const Icon = DOMAIN_ICONS[domain.type] || Cog;
            return (
              <button
                key={domain.id}
                type="button"
                onClick={() => onJumpToDomain(domain.id)}
                className="flex w-full items-center gap-3 rounded border border-white/10 bg-black/20 px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-white/[0.04]"
              >
                <Icon className="h-4 w-4 text-primary/80" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-mono text-[11px] uppercase text-foreground">
                    <span className="truncate">{domain.label}</span>
                    <span className="text-[8px] text-muted-foreground/70">{domain.type}</span>
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/80">
                    {domain.itemCount} items
                    {domain.problemCount > 0 && ` · ${domain.problemCount} problem${domain.problemCount === 1 ? "" : "s"}`}
                    {domain.warnings.length > 0 && ` · ${domain.warnings.length} warning${domain.warnings.length === 1 ? "" : "s"}`}
                  </p>
                </div>
                <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase", HEALTH_TONE[domain.health])}>
                  {domain.health}
                </span>
              </button>
            );
          })}
          {report.unsupportedDomains.length > 0 && (
            <div className="rounded border border-orange-400/40 bg-orange-500/5 px-3 py-2 font-mono text-[10px] text-orange-300">
              <p className="font-bold uppercase">Unavailable adapters</p>
              <p className="mt-1 text-[9px] text-orange-200/80">
                {report.unsupportedDomains.map((entry) => `${entry.label} (${entry.type})`).join(", ")}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function IssuesPanel({
  report,
  warnings,
  onJumpToDomain,
}: {
  report: SkillNexusReport | null;
  warnings: Array<{ domainId: string; domainLabel: string; warning: string }>;
  onJumpToDomain: (id: string) => void;
}) {
  const problems = useMemo(() => {
    if (!report) return [];
    const out: Array<{ domain: DomainSnapshot; item: SkillNexusItem }> = [];
    for (const domain of report.domains) {
      for (const item of domain.items) {
        if (item.status && item.status !== "ok" && item.status !== "pending" && item.status !== "candidate") {
          out.push({ domain, item });
        }
      }
    }
    return out;
  }, [report]);

  return (
    <div className="space-y-3">
      <ScrollArea className="h-[320px] rounded border border-white/10 bg-black/30 p-2">
        <div className="space-y-2">
          {warnings.length === 0 && problems.length === 0 && (
            <div className="rounded border border-white/10 bg-black/20 p-3 font-mono text-[10px] text-muted-foreground">
              All clear — no warnings or item problems.
            </div>
          )}
          {warnings.map((entry, idx) => (
            <div key={`warn-${idx}`} className="flex items-start gap-2 rounded border border-yellow-500/30 bg-yellow-500/5 px-2 py-1.5 font-mono text-[10px]">
              <FileWarning className="mt-0.5 h-3 w-3 shrink-0 text-yellow-400" />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onJumpToDomain(entry.domainId)}
                  className="font-bold uppercase text-yellow-300 hover:underline"
                >
                  {entry.domainLabel}
                </button>
                <p className="text-[9px] text-yellow-200/80">{entry.warning}</p>
              </div>
            </div>
          ))}
          {problems.map(({ domain, item }) => (
            <div key={`prob-${domain.id}-${item.id}`} className={cn("flex items-start gap-2 rounded border px-2 py-1.5 font-mono text-[10px]", STATUS_TONE[item.status || "error"])}>
              <span className="shrink-0 rounded border px-1 text-[8px] uppercase">{item.status}</span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onJumpToDomain(domain.id)}
                  className="truncate font-bold hover:underline"
                >
                  {item.name}
                </button>
                <p className="truncate text-[9px] opacity-80">
                  {domain.label}{item.relativePath ? ` · ${item.relativePath}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function DomainPanel({
  domain,
  statusFilter,
  onStatusFilter,
  expanded,
}: {
  domain: DomainSnapshot;
  statusFilter: "all" | "problems";
  onStatusFilter: (value: "all" | "problems") => void;
  expanded: boolean;
}) {
  const visible = useMemo(() => {
    if (statusFilter === "problems") {
      return domain.items.filter((item) => item.status && item.status !== "ok");
    }
    return domain.items;
  }, [domain.items, statusFilter]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase text-muted-foreground">
          <span className={cn("rounded border px-1.5 py-0.5", HEALTH_TONE[domain.health])}>
            {domain.health}
          </span>
          <span>{domain.itemCount} items</span>
          {domain.problemCount > 0 && (
            <span className="text-destructive">{domain.problemCount} problems</span>
          )}
          <span className="text-muted-foreground/60">type: {domain.type}</span>
        </div>
        <div className="flex items-center gap-1 rounded border border-white/10 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => onStatusFilter("all")}
            className={cn(
              "rounded px-2 py-0.5 font-mono text-[9px] uppercase",
              statusFilter === "all" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-slate-100"
            )}
          >
            All ({domain.itemCount})
          </button>
          <button
            type="button"
            onClick={() => onStatusFilter("problems")}
            className={cn(
              "rounded px-2 py-0.5 font-mono text-[9px] uppercase",
              statusFilter === "problems" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-slate-100"
            )}
          >
            Problems ({domain.problemCount})
          </button>
        </div>
      </div>

      {domain.warnings.length > 0 && (
        <div className="space-y-1">
          {domain.warnings.map((warning, idx) => (
            <div key={idx} className="flex items-center gap-2 rounded border border-yellow-500/30 bg-yellow-500/5 px-2 py-1 font-mono text-[9px] text-yellow-200/90">
              <FileWarning className="h-3 w-3 text-yellow-400" />
              <span className="truncate" title={warning}>{warning}</span>
            </div>
          ))}
        </div>
      )}

      <ScrollArea className={cn("rounded border border-white/10 bg-black/30 p-2", expanded ? "h-[calc(100vh-22rem)]" : "h-[300px]")}>
        <div className="space-y-1">
          {visible.length === 0 ? (
            <div className="rounded border border-white/10 bg-black/20 p-3 font-mono text-[10px] text-muted-foreground">
              {statusFilter === "problems" ? "No problems in this domain." : "No items yet."}
            </div>
          ) : (
            visible.slice(0, 200).map((item) => (
              <div
                key={item.id}
                className={cn(
                  "rounded border px-2 py-1 font-mono text-[10px]",
                  STATUS_TONE[item.status || "ok"]
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded border px-1 text-[8px] uppercase">{item.status || "ok"}</span>
                  <span className="min-w-0 flex-1 truncate font-bold" title={item.name}>{item.name}</span>
                  {item.mtime && (
                    <span className="shrink-0 text-[8px] opacity-70">{formatAgo(item.mtime)}</span>
                  )}
                  {item.size !== undefined && (
                    <span className="shrink-0 text-[8px] opacity-70">{formatBytes(item.size)}</span>
                  )}
                </div>
                {item.description && (
                  <p className="mt-0.5 truncate text-[9px] opacity-80">{item.description}</p>
                )}
                {(item.relativePath || (item.tags && item.tags.length > 0)) && (
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 truncate text-[8px] opacity-60">
                    {item.relativePath && <span>{item.relativePath}</span>}
                    {item.tags?.map((tag) => (
                      <span key={tag} className="rounded border border-current/20 px-1">{tag}</span>
                    ))}
                  </p>
                )}
              </div>
            ))
          )}
          {visible.length > 200 && (
            <div className="rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[9px] text-muted-foreground">
              Showing first 200 of {visible.length} items.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 px-2 py-2 font-mono">
      <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground">
        <Icon className={cn("h-3 w-3", tone)} />
        <span>{label}</span>
      </div>
      <p className={cn("mt-1 text-base font-bold", tone)}>{value}</p>
    </div>
  );
}
