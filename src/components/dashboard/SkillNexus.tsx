"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Award,
  BarChart3,
  BookOpen,
  Boxes,
  Brain,
  Check,
  Clock,
  Cog,
  Copy,
  Database,
  Dna,
  FileWarning,
  Flame,
  Gauge,
  GitBranch,
  Layers,
  Maximize2,
  Minimize2,
  Network,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

type SkillItemStatus =
  | "ok" | "stale" | "duplicate" | "conflicted" | "missing"
  | "oversized" | "error" | "pending" | "candidate" | "deprecated"
  | "rejected"; // Expected non-promotion outcome — not flagged as a problem.

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
  // "rejected" is rendered with the same muted tone as deprecated but is intentionally
  // not flagged as a problem — see IssuesPanel filter.
  rejected: "border-muted-foreground/20 text-muted-foreground/80 bg-muted/5",
};

const HEALTH_TONE: Record<DomainHealth, string> = {
  ok: "border-secondary/40 text-secondary",
  degraded: "border-yellow-500/40 text-yellow-400",
  unreachable: "border-destructive/40 text-destructive",
  disabled: "border-white/10 text-muted-foreground",
  unsupported: "border-orange-400/40 text-orange-300",
  empty: "border-white/10 text-muted-foreground",
};

// IMC compliance bands. The Evolver feed emits one of these via meta.imc when
// evolution_meta.json contains a final_score (per the IMC.md scoring table).
const IMC_TONE: Record<string, string> = {
  full: "border-secondary/50 text-secondary bg-secondary/10",
  good: "border-primary/50 text-primary bg-primary/10",
  partial: "border-yellow-500/50 text-yellow-400 bg-yellow-500/10",
  poor: "border-destructive/50 text-destructive bg-destructive/10",
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
            <TabButton
              active={activeTab === "insights"}
              onClick={() => setActiveTab("insights")}
              icon={BarChart3}
              label="Insights"
              count={totals?.items}
              tone="border-primary/30 text-primary"
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
            <TabButton
              active={activeTab === "info"}
              onClick={() => setActiveTab("info")}
              icon={BookOpen}
              label="Info"
              tone="border-primary/30 text-primary"
            />
          </div>

          {/* === Tab content === */}
          <div className={cn("min-h-0 flex-1", expanded ? "overflow-hidden" : "")}>
            {activeTab === "overview" && (
              <OverviewPanel report={report} onJumpToDomain={setActiveTab} />
            )}
            {activeTab === "insights" && (
              <InsightsPanel report={report} expanded={expanded} />
            )}
            {activeTab === "issues" && (
              <IssuesPanel report={report} warnings={allWarnings} onJumpToDomain={setActiveTab} />
            )}
            {activeTab === "info" && (
              <InfoPanel report={report} expanded={expanded} />
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

// Pull a human-readable failure reason from an item's status + description + meta. Adapters
// stuff different shapes here (judge subscores under llm_*, evolution kept/improvement,
// skill-root duplicate/stale, etc.) so this digests them into one line per row.
function reasonFor(item: SkillNexusItem): string {
  const m = (item.meta || {}) as Record<string, unknown>;
  const parts: string[] = [];

  // Experiment-results judge fails: surface composite + which judge dragged it down.
  if (typeof m.composite === "number") {
    parts.push(`composite ${m.composite}`);
    const judgeKeys = Object.keys(m).filter((k) => k.startsWith("judge_"));
    if (judgeKeys.length > 0) {
      // Find the weakest judge (lowest score).
      let weakest = judgeKeys[0];
      let weakestScore = Number(m[weakest]);
      for (const k of judgeKeys) {
        const v = Number(m[k]);
        if (Number.isFinite(v) && v < weakestScore) { weakest = k; weakestScore = v; }
      }
      parts.push(`${weakest.replace(/^judge_/, "")} ${weakestScore}`);
    }
    // LLM judge sub-dimensions (task/error/token/decision/context) when present.
    const llmDims = Object.keys(m).filter((k) => k.startsWith("llm_"));
    if (llmDims.length > 0) {
      const subs = llmDims.map((k) => `${k.replace(/^llm_/, "")}=${m[k]}`).join(" ");
      parts.push(`llm[${subs}]`);
    }
    if (typeof m.tested === "string" && m.tested) parts.push(`tested: ${m.tested}`);
  }

  // Evolution-history rows (kept=false, negative improvement).
  if (typeof m.improvement === "number" && typeof m.kept === "boolean") {
    if (!parts.length) parts.push(`improvement ${m.improvement}, ${m.kept ? "kept" : "rejected"}`);
  }

  // Skill-evolver lineage failures.
  if (typeof m.failure_reason === "string" && m.failure_reason) {
    parts.push(`reason: ${m.failure_reason}`);
  }

  // Skill-root signals.
  if (item.relativePath) parts.push(item.relativePath);

  // Fallback to description if we haven't extracted anything yet.
  if (parts.length === 0 && item.description) parts.push(item.description);
  return parts.join(" · ");
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
  const [copied, setCopied] = useState(false);

  const problems = useMemo(() => {
    if (!report) return [];
    const out: Array<{ domain: DomainSnapshot; item: SkillNexusItem; reason: string }> = [];
    for (const domain of report.domains) {
      for (const item of domain.items) {
        // Catch every fail-like status: error, stale, duplicate, conflicted, missing,
        // oversized, deprecated. Pending and candidate are in-flight, not fails.
        // Skip in-flight states (pending, candidate) AND expected non-promotion outcomes
        // (rejected). Most evolution trials reject by design — flagging them as problems
        // turns the Issues feed into noise.
        if (item.status && item.status !== "ok" && item.status !== "pending" && item.status !== "candidate" && item.status !== "rejected") {
          out.push({ domain, item, reason: reasonFor(item) });
        }
      }
    }
    // Surface judge-failed experiments at the top — they're often the most actionable.
    out.sort((a, b) => {
      const aJudge = a.domain.id === "experiment-results" || a.domain.id === "evolution-history" ? 0 : 1;
      const bJudge = b.domain.id === "experiment-results" || b.domain.id === "evolution-history" ? 0 : 1;
      return aJudge - bJudge;
    });
    return out;
  }, [report]);

  const copyAll = useCallback(async () => {
    const lines: string[] = [];
    lines.push(`Skill Nexus — Issues Report (${new Date().toISOString()})`);
    lines.push("");
    if (warnings.length > 0) {
      lines.push(`# Domain warnings (${warnings.length})`);
      for (const w of warnings) {
        lines.push(`  [${w.domainLabel}] ${w.warning}`);
      }
      lines.push("");
    }
    if (problems.length > 0) {
      lines.push(`# Item problems (${problems.length})`);
      for (const p of problems) {
        const line = `  [${p.item.status?.toUpperCase()}] ${p.domain.label} · ${p.item.name}`;
        lines.push(line);
        if (p.reason) lines.push(`      ${p.reason}`);
      }
    }
    if (warnings.length === 0 && problems.length === 0) {
      lines.push("All clear — no warnings or item problems.");
    }
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail (e.g. unfocused tab) — fallback: select an off-screen textarea.
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      try { document.execCommand("copy"); } catch { /* swallow */ }
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [warnings, problems]);

  const total = warnings.length + problems.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] uppercase text-muted-foreground">
          {total === 0 ? "0 issues" : `${total} total · ${warnings.length} warning${warnings.length === 1 ? "" : "s"} · ${problems.length} fail${problems.length === 1 ? "" : "s"}`}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 border-white/10 bg-transparent px-2 py-0 font-mono text-[9px] uppercase hover:bg-white/5"
          onClick={() => void copyAll()}
          disabled={total === 0}
          title="Copy every warning + every fail with reasons to clipboard"
        >
          {copied ? <Check className="mr-1 h-3 w-3 text-secondary" /> : <Copy className="mr-1 h-3 w-3" />}
          {copied ? "Copied" : "Copy all"}
        </Button>
      </div>
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
          {problems.map(({ domain, item, reason }) => (
            <div key={`prob-${domain.id}-${item.id}`} className={cn("flex items-start gap-2 rounded border px-2 py-1.5 font-mono text-[10px]", STATUS_TONE[item.status || "error"])}>
              <span className="shrink-0 rounded border px-1 text-[8px] uppercase">{item.status}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <button
                    type="button"
                    onClick={() => onJumpToDomain(domain.id)}
                    className="truncate font-bold hover:underline"
                  >
                    {item.name}
                  </button>
                  <span className="shrink-0 text-[8px] uppercase opacity-60">{domain.label}</span>
                </div>
                {reason && (
                  <p className="truncate text-[9px] opacity-80" title={reason}>
                    {reason}
                  </p>
                )}
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
            visible.slice(0, 200).map((item, idx) => {
              const meta = item.meta || {};
              const imcLevel = typeof meta.imc === "string" ? meta.imc : "";
              const imcScore = typeof meta.imcScore === "number" ? meta.imcScore : undefined;
              const judgment = typeof meta.judgment === "string" ? meta.judgment : "";
              const hasImc = Boolean(imcLevel || imcScore !== undefined || judgment);
              return (
                <div
                  key={`${item.id}-${idx}`}
                  className={cn(
                    "rounded border px-2 py-1 font-mono text-[10px]",
                    STATUS_TONE[item.status || "ok"]
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded border px-1 text-[8px] uppercase">{item.status || "ok"}</span>
                    <span className="min-w-0 flex-1 truncate font-bold" title={item.name}>{item.name}</span>
                    {hasImc && (
                      <span
                        className={cn(
                          "shrink-0 inline-flex items-center gap-1 rounded border px-1.5 py-px text-[8px] uppercase",
                          IMC_TONE[imcLevel] || "border-primary/40 text-primary"
                        )}
                        title={`IMC compliance${imcScore !== undefined ? ` · score ${imcScore}/100` : ""}${judgment ? ` · evolver judgment: ${judgment}` : ""}`}
                      >
                        <Gauge className="h-2.5 w-2.5" />
                        <span>IMC{imcLevel ? ` · ${imcLevel}` : ""}</span>
                        {imcScore !== undefined && <span className="opacity-80">{imcScore}</span>}
                      </span>
                    )}
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
                  {hasImc && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[8px] opacity-75">
                      {judgment && <span className="rounded border border-current/30 px-1 uppercase">judgment: {judgment}</span>}
                      {typeof meta.actionability === "number" && <span title="IMC: explicit commands present">act {meta.actionability}</span>}
                      {typeof meta.clarity === "number" && <span title="IMC: clarity / structure">clar {meta.clarity}</span>}
                      {typeof meta.specificity === "number" && <span title="IMC: no fictional paths">spec {meta.specificity}</span>}
                      {typeof meta.examples === "number" && <span title="IMC: examples count">ex {meta.examples}</span>}
                      {typeof meta.steps === "number" && <span title="IMC: numbered executable steps">steps {meta.steps}</span>}
                    </p>
                  )}
                  {(item.relativePath || (item.tags && item.tags.length > 0)) && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 truncate text-[8px] opacity-60">
                      {item.relativePath && <span>{item.relativePath}</span>}
                      {item.tags?.filter((tag) => !tag.startsWith("imc:") && tag !== judgment).map((tag) => (
                        <span key={tag} className="rounded border border-current/20 px-1">{tag}</span>
                      ))}
                    </p>
                  )}
                </div>
              );
            })
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

// === Info / InfoDec panel =============================================
// Static in-app documentation so anyone opening the HUD can understand what each
// Skill Nexus facet does, what statuses mean, and how IMC scoring is wired in.
// Built from the actual codebase shape, not aspirational marketing — every claim
// here mirrors a real adapter, status, or meta field.

const DOMAIN_DOCS: Array<{ type: string; icon: any; title: string; what: string; reads: string }> = [
  { type: "skillRoot",    icon: Layers,    title: "Skill Roots",          what: "Walks a skill library directory, treats SKILL.md as authoritative + other .md/.json/.yaml as docs.", reads: "frontmatter title/description, file hash, size, mtime, dup-name detection, stale (>90 d)" },
  { type: "skillForge",   icon: Flame,     title: "Skill Forge",          what: "Watches a forge queue (JSONL) + output directory. Surfaces drafts, candidates, promoted, failed, archived.", reads: "queue state per job, output folder integrity (missing SKILL.md flagged)" },
  { type: "skillEvolver", icon: Dna,       title: "Skill Evolver",        what: "Pairs every *-evolved skill with its parent. Reads the evolver's per-skill evolution_meta.json + state + applied genome.", reads: "final_score, judgment (promote/revise/reject), genome dimensions, IMC compliance level" },
  { type: "sessionMiner", icon: Brain,     title: "Session Miner",        what: "Reads mined skill candidates from outputDir/outputFile (endpoint/command modes are stubbed).", reads: "candidate name, session hash, confidence, suggested action — never raw chat" },
  { type: "reportFile",   icon: Database,  title: "Report Files",         what: "Generic JSON/JSONL ingester for validation runs, council status snapshots, build outputs.", reads: "name, severity, score, passed/failed/pending, timestamp" },
  { type: "projectDocs",  icon: GitBranch, title: "Project Docs",         what: "Shallow walk of a project's per-feature skill docs (NEXUS_SKILLS.md, etc.).", reads: "frontmatter, headers, stale (>120 d)" },
  { type: "syncStatus",   icon: Network,   title: "Cross-Agent Sync",     what: "Snapshot of multi-agent skill sync — which agent has what, what's missing/conflicting.", reads: "lastSync, missing count, conflict count" },
  { type: "genericJson",  icon: Boxes,     title: "Generic JSON",         what: "Fallback adapter for any other JSON snapshot the operator wants surfaced.", reads: "top-level entries by name/title/description" },
];

const STATUS_DOCS: Array<{ status: SkillItemStatus; label: string; meaning: string }> = [
  { status: "ok",         label: "ok",         meaning: "Item is healthy. SKILL.md present, parent paired, not stale, evolver judgment is promote (when applicable)." },
  { status: "stale",      label: "stale",      meaning: "File hasn't been touched in a long time (60 d evolved / 90 d skill / 120 d doc / 7 d report). Or IMC bands at partial/poor." },
  { status: "duplicate",  label: "duplicate",  meaning: "Another item in the same domain shares this skill's name." },
  { status: "conflicted", label: "conflicted", meaning: "Sync adapter found a divergence between agents." },
  { status: "missing",    label: "missing",    meaning: "Required pair/parent is absent. e.g. -evolved skill whose source was deleted." },
  { status: "oversized",  label: "oversized",  meaning: "File exceeds skillNexus.maxFileBytes (default 512 KB). Skipped to keep scans cheap." },
  { status: "error",      label: "error",      meaning: "Parse error, missing SKILL.md, evolver judgment=reject/fail, or generic adapter failure." },
  { status: "pending",    label: "pending",    meaning: "Queued — forge job not yet run, evolver judgment=revise, report severity=pending." },
  { status: "candidate",  label: "candidate",  meaning: "Mined or forged but not yet promoted. Eligible for review." },
  { status: "deprecated", label: "deprecated", meaning: "Archived or marked obsolete by the source." },
];

function InfoPanel({ report, expanded }: { report: SkillNexusReport | null; expanded: boolean }) {
  const usedTypes = useMemo(() => {
    const set = new Set<string>();
    (report?.domains ?? []).forEach((domain) => set.add(domain.type));
    return set;
  }, [report]);

  return (
    <ScrollArea className={cn("rounded border border-white/10 bg-black/30 p-3", expanded ? "h-[calc(100vh-22rem)]" : "h-[420px]")}>
      <div className="space-y-4 pr-2 font-mono text-[10px] leading-relaxed text-slate-200">

        <section>
          <h4 className="mb-1 flex items-center gap-2 font-headline text-[11px] font-bold uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" /> What is Skill Nexus?
          </h4>
          <p className="text-muted-foreground">
            A federated registry that monitors every place skills are produced, scored, or organised on this machine.
            Each entry in <code className="text-primary">skillNexus.domains[]</code> in <code className="text-primary">council.config.local.json</code>
            is observed by a typed adapter. Unknown types render as &quot;unavailable adapter&quot; instead of crashing.
            All paths are redacted to relative paths before reaching this UI.
          </p>
        </section>

        <section>
          <h4 className="mb-1 flex items-center gap-2 font-headline text-[11px] font-bold uppercase tracking-wider text-primary">
            <Layers className="h-3.5 w-3.5" /> Domain types
          </h4>
          <div className="space-y-1.5">
            {DOMAIN_DOCS.map((doc) => {
              const Icon = doc.icon;
              const inUse = usedTypes.has(doc.type);
              return (
                <div
                  key={doc.type}
                  className={cn(
                    "rounded border px-2 py-1.5",
                    inUse ? "border-secondary/30 bg-secondary/5" : "border-white/10 bg-black/20"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-3 w-3", inUse ? "text-secondary" : "text-muted-foreground")} />
                    <span className="font-bold uppercase tracking-wider">{doc.title}</span>
                    <span className="text-[8px] uppercase text-muted-foreground/70">type: {doc.type}</span>
                    {inUse && <span className="rounded border border-secondary/40 px-1 text-[8px] uppercase text-secondary">in use</span>}
                  </div>
                  <p className="mt-1 text-muted-foreground">{doc.what}</p>
                  <p className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/70">
                    reads: <span className="text-foreground/80 normal-case">{doc.reads}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h4 className="mb-1 flex items-center gap-2 font-headline text-[11px] font-bold uppercase tracking-wider text-primary">
            <Gauge className="h-3.5 w-3.5" /> IMC — Idiot Model Cost
          </h4>
          <p className="text-muted-foreground">
            IMC is the council&apos;s permanent quality rule: design for the weakest model that might run the skill. The
            Skill Evolver scores every evolved skill against the same axes IMC defines. When an item has IMC data, it&apos;s
            badged in the row with a <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1 text-primary"><Gauge className="h-2.5 w-2.5" />IMC</span> tag.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <div className={cn("rounded border px-2 py-1.5 text-center", IMC_TONE.full)}>
              <p className="text-[9px] uppercase opacity-80">full</p><p className="text-sm font-bold">≥ 90</p>
            </div>
            <div className={cn("rounded border px-2 py-1.5 text-center", IMC_TONE.good)}>
              <p className="text-[9px] uppercase opacity-80">good</p><p className="text-sm font-bold">≥ 70</p>
            </div>
            <div className={cn("rounded border px-2 py-1.5 text-center", IMC_TONE.partial)}>
              <p className="text-[9px] uppercase opacity-80">partial</p><p className="text-sm font-bold">≥ 50</p>
            </div>
            <div className={cn("rounded border px-2 py-1.5 text-center", IMC_TONE.poor)}>
              <p className="text-[9px] uppercase opacity-80">poor</p><p className="text-sm font-bold">&lt; 50</p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground sm:grid-cols-3">
            <p><strong className="text-foreground">act</strong> — actionability: explicit commands, not descriptions</p>
            <p><strong className="text-foreground">clar</strong> — clarity: headers, structure, examples</p>
            <p><strong className="text-foreground">spec</strong> — specificity: no fictional paths</p>
            <p><strong className="text-foreground">ex</strong> — examples count provided</p>
            <p><strong className="text-foreground">steps</strong> — numbered executable steps</p>
            <p><strong className="text-foreground">judgment</strong> — evolver verdict: promote / revise / reject</p>
          </div>
        </section>

        <section>
          <h4 className="mb-1 flex items-center gap-2 font-headline text-[11px] font-bold uppercase tracking-wider text-primary">
            <ShieldCheck className="h-3.5 w-3.5" /> Item statuses
          </h4>
          <div className="space-y-1">
            {STATUS_DOCS.map((doc) => (
              <div key={doc.status} className="flex items-start gap-2">
                <span className={cn("shrink-0 rounded border px-1 py-px text-[8px] uppercase", STATUS_TONE[doc.status])}>
                  {doc.label}
                </span>
                <span className="flex-1 text-muted-foreground">{doc.meaning}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h4 className="mb-1 flex items-center gap-2 font-headline text-[11px] font-bold uppercase tracking-wider text-primary">
            <BookOpen className="h-3.5 w-3.5" /> Tabs in this card
          </h4>
          <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground marker:text-primary">
            <li><strong className="text-foreground">Overview</strong> — totals + per-domain summary rows (click to jump).</li>
            <li><strong className="text-foreground">&lt;Each domain&gt;</strong> — auto-derived tab per configured domain. Filter All / Problems.</li>
            <li><strong className="text-foreground">Issues</strong> — every warning + every non-ok item flattened into one feed.</li>
            <li><strong className="text-foreground">Info</strong> — this panel.</li>
          </ul>
        </section>

        <section>
          <h4 className="mb-1 flex items-center gap-2 font-headline text-[11px] font-bold uppercase tracking-wider text-primary">
            <ShieldCheck className="h-3.5 w-3.5" /> Privacy
          </h4>
          <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground marker:text-primary">
            <li>All adapters return relative paths only — never absolute machine paths.</li>
            <li>Real source paths live in <code className="text-primary">council.config.local.json</code> (gitignored).</li>
            <li>Public <code className="text-primary">council.config.example.json</code> ships placeholders only.</li>
            <li>API route is gated by <code className="text-primary">canUseLocalCouncilApi</code>; remote requests get 403.</li>
            <li>Session Miner / Skill Forge summarise — they never expose raw chat or evolver content.</li>
          </ul>
        </section>

        {report && (
          <section>
            <h4 className="mb-1 flex items-center gap-2 font-headline text-[11px] font-bold uppercase tracking-wider text-primary">
              <Cog className="h-3.5 w-3.5" /> This snapshot
            </h4>
            <p className="text-muted-foreground">
              {report.totals.domains} domains configured · {report.totals.enabledDomains} enabled · {report.totals.healthyDomains} healthy · {report.totals.items} items · {report.totals.problems} problems · {report.totals.warnings} warnings.
              Auto-refresh every {Math.round(report.pollIntervalMs / 1000)} s.
            </p>
          </section>
        )}
      </div>
    </ScrollArea>
  );
}

// === Insights panel ===================================================
// Aggregate views computed client-side from the report. Surfaces what's
// passing, what's been evolved, IMC compliance distribution, etc.

function InsightsPanel({ report, expanded }: { report: SkillNexusReport | null; expanded: boolean }) {
  const data = useMemo(() => {
    if (!report) return null;

    // Pool all items across every domain, keeping the source domain reference.
    type Row = { item: SkillNexusItem; domain: DomainSnapshot };
    const all: Row[] = [];
    for (const domain of report.domains) {
      for (const item of domain.items) all.push({ item, domain });
    }

    const skillRoots = report.domains.filter((domain) => domain.type === "skillRoot");
    const skillItems = skillRoots.flatMap((domain) => domain.items.map((item) => ({ item, domain })))
      .filter(({ item }) => item.tags?.includes("skill"));
    const docItems = skillRoots.flatMap((domain) => domain.items.map((item) => ({ item, domain })))
      .filter(({ item }) => item.tags?.includes("doc"));

    // Evolution counts: every skillEvolver "evolved/paired" item contributes one evolution
    // to its parent. Map parent → count.
    const evolutionCounts = new Map<string, { parent: string; evolved: Row[]; bestScore: number }>();
    for (const domain of report.domains) {
      if (domain.type !== "skillEvolver") continue;
      for (const item of domain.items) {
        if (!item.tags?.includes("evolved")) continue;
        const parent = String(item.meta?.parent || "");
        if (!parent) continue;
        const score = typeof item.meta?.imcScore === "number" ? item.meta.imcScore : 0;
        const entry = evolutionCounts.get(parent) || { parent, evolved: [], bestScore: 0 };
        entry.evolved.push({ item, domain });
        if (score > entry.bestScore) entry.bestScore = score;
        evolutionCounts.set(parent, entry);
      }
    }
    const mostEvolved = Array.from(evolutionCounts.values())
      .sort((a, b) => b.evolved.length - a.evolved.length || b.bestScore - a.bestScore)
      .slice(0, 12);

    // IMC distribution across every item that has imc set.
    const imcBuckets: Record<string, number> = { full: 0, good: 0, partial: 0, poor: 0 };
    let imcSampleCount = 0;
    let imcScoreSum = 0;
    for (const { item } of all) {
      const lvl = String(item.meta?.imc || "");
      if (lvl in imcBuckets) {
        imcBuckets[lvl] += 1;
        imcSampleCount += 1;
        const score = Number(item.meta?.imcScore);
        if (Number.isFinite(score)) imcScoreSum += score;
      }
    }
    const imcAverage = imcSampleCount > 0 ? Math.round(imcScoreSum / imcSampleCount) : 0;

    // Top passing items: status === "ok" or judgment === "promote", sorted by IMC score then mtime.
    const passing = all
      .filter(({ item }) => {
        const status = item.status || "ok";
        return status === "ok" || item.meta?.judgment === "promote";
      })
      .map(({ item, domain }) => ({
        item,
        domain,
        score: typeof item.meta?.imcScore === "number" ? item.meta.imcScore : null,
      }))
      .filter((row) => row.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 12);

    // Recently changed items (last 7 days, sorted newest first).
    const sevenDays = 7 * 86_400_000;
    const recent = all
      .filter(({ item }) => item.mtime && Date.now() - item.mtime < sevenDays)
      .sort((a, b) => (b.item.mtime || 0) - (a.item.mtime || 0))
      .slice(0, 10);

    // Items per skillRoot domain — quick bar.
    const perDomain = skillRoots.map((domain) => ({
      label: domain.label,
      total: domain.items.length,
      skills: domain.items.filter((item) => item.tags?.includes("skill")).length,
      docs: domain.items.filter((item) => item.tags?.includes("doc")).length,
      health: domain.health,
    }));

    return {
      totals: {
        skillFiles: skillItems.length,
        docFiles: docItems.length,
        evolved: Array.from(evolutionCounts.values()).reduce((sum, entry) => sum + entry.evolved.length, 0),
        evolvedParents: evolutionCounts.size,
        passingWithScore: passing.length,
        imcAverage,
      },
      imcBuckets,
      imcSampleCount,
      mostEvolved,
      passing,
      recent,
      perDomain,
    };
  }, [report]);

  if (!data) {
    return (
      <div className="rounded border border-white/10 bg-black/20 p-3 font-mono text-[10px] text-muted-foreground">
        Loading insights…
      </div>
    );
  }

  const { totals, imcBuckets, imcSampleCount, mostEvolved, passing, recent, perDomain } = data;
  const imcMax = Math.max(1, ...Object.values(imcBuckets));

  return (
    <ScrollArea className={cn("rounded border border-white/10 bg-black/30 p-3", expanded ? "h-[calc(100vh-22rem)]" : "h-[420px]")}>
      <div className="space-y-4 pr-2">

        {/* Headline counters */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <InsightTile icon={Layers}   label="Skill files"    value={totals.skillFiles} tone="text-primary" />
          <InsightTile icon={Dna}      label="Evolved"        value={totals.evolved}    sub={`${totals.evolvedParents} parents`} tone="text-fuchsia-300" />
          <InsightTile icon={Award}    label="Passing (IMC)"  value={totals.passingWithScore} sub={`avg ${totals.imcAverage}`}    tone="text-secondary" />
          <InsightTile icon={BookOpen} label="Docs"           value={totals.docFiles}   tone="text-muted-foreground" />
        </div>

        {/* IMC distribution */}
        <section>
          <h4 className="mb-1 flex items-center gap-2 font-headline text-[10px] font-bold uppercase tracking-wider text-primary">
            <Gauge className="h-3 w-3" /> IMC compliance ({imcSampleCount} scored)
          </h4>
          <div className="space-y-1.5">
            {(["full", "good", "partial", "poor"] as const).map((band) => (
              <div key={band} className="flex items-center gap-2 font-mono text-[10px]">
                <span className={cn("w-14 shrink-0 rounded border px-1 text-center text-[8px] uppercase", IMC_TONE[band])}>
                  {band}
                </span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className={cn(
                      "h-full transition-all",
                      band === "full" ? "bg-secondary/80"
                      : band === "good" ? "bg-primary/80"
                      : band === "partial" ? "bg-yellow-500/80"
                      : "bg-destructive/80"
                    )}
                    style={{ width: `${(imcBuckets[band] / imcMax) * 100}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-[9px] text-muted-foreground tabular-nums">
                  {imcBuckets[band]}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Top scorers */}
        {passing.length > 0 && (
          <section>
            <h4 className="mb-1 flex items-center gap-2 font-headline text-[10px] font-bold uppercase tracking-wider text-primary">
              <Award className="h-3 w-3" /> Top passing skills
            </h4>
            <div className="space-y-1">
              {passing.map(({ item, domain, score }, idx) => (
                <div key={`${domain.id}:${item.id}:${idx}`} className="flex items-center gap-2 rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[10px]">
                  <span className="w-5 shrink-0 text-center text-[9px] text-muted-foreground/70">#{idx + 1}</span>
                  <span className={cn("shrink-0 inline-flex items-center gap-1 rounded border px-1.5 text-[8px] uppercase", IMC_TONE[String(item.meta?.imc || "good")] || "border-primary/30 text-primary")}>
                    <Gauge className="h-2.5 w-2.5" />
                    {score}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-bold" title={item.name}>{item.name}</span>
                  <span className="shrink-0 text-[8px] uppercase text-muted-foreground/70">{domain.label}</span>
                  {item.meta?.judgment && (
                    <span className="shrink-0 rounded border border-current/30 px-1 text-[8px] uppercase">{String(item.meta.judgment)}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Most-evolved lineage */}
        {mostEvolved.length > 0 && (
          <section>
            <h4 className="mb-1 flex items-center gap-2 font-headline text-[10px] font-bold uppercase tracking-wider text-primary">
              <TrendingUp className="h-3 w-3" /> Most-evolved parents ({totals.evolvedParents} total)
            </h4>
            <div className="space-y-1">
              {mostEvolved.map((entry) => (
                <div key={entry.parent} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 font-mono text-[10px]">
                  <div className="flex items-center gap-2">
                    <Dna className="h-3 w-3 text-fuchsia-300" />
                    <span className="min-w-0 flex-1 truncate font-bold" title={entry.parent}>{entry.parent}</span>
                    <span className="shrink-0 rounded border border-fuchsia-400/40 px-1 text-[8px] uppercase text-fuchsia-300">
                      {entry.evolved.length}× evolved
                    </span>
                    {entry.bestScore > 0 && (
                      <span className={cn("shrink-0 rounded border px-1 text-[8px] uppercase", entry.bestScore >= 90 ? IMC_TONE.full : entry.bestScore >= 70 ? IMC_TONE.good : entry.bestScore >= 50 ? IMC_TONE.partial : IMC_TONE.poor)}>
                        best {entry.bestScore}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 flex flex-wrap gap-1 text-[8px] opacity-70">
                    {entry.evolved.slice(0, 5).map(({ item }, evolvedIdx) => {
                      const score = typeof item.meta?.imcScore === "number" ? item.meta.imcScore : null;
                      const judgment = String(item.meta?.judgment || "");
                      return (
                        <span
                          key={`${entry.parent}:${item.id}:${evolvedIdx}`}
                          className={cn(
                            "rounded border px-1",
                            judgment === "promote" ? "border-secondary/40 text-secondary"
                            : judgment === "reject" ? "border-destructive/40 text-destructive"
                            : judgment === "revise" ? "border-yellow-500/40 text-yellow-400"
                            : "border-current/30"
                          )}
                          title={item.relativePath || item.name}
                        >
                          {score !== null ? `${score}` : "·"} {judgment || "ok"}
                        </span>
                      );
                    })}
                    {entry.evolved.length > 5 && (
                      <span className="rounded border border-current/30 px-1 text-muted-foreground">
                        +{entry.evolved.length - 5} more
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Per-domain breakdown bars */}
        <section>
          <h4 className="mb-1 flex items-center gap-2 font-headline text-[10px] font-bold uppercase tracking-wider text-primary">
            <Layers className="h-3 w-3" /> Skill counts per library
          </h4>
          <div className="space-y-1">
            {perDomain.map((row) => {
              const max = Math.max(1, ...perDomain.map((d) => d.total));
              return (
                <div key={row.label} className="font-mono text-[10px]">
                  <div className="flex items-center justify-between">
                    <span className="truncate" title={row.label}>{row.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {row.skills} skills · {row.docs} docs
                    </span>
                  </div>
                  <div className="relative mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={cn(
                        "h-full transition-all",
                        row.health === "ok" ? "bg-secondary/80"
                        : row.health === "degraded" ? "bg-yellow-500/80"
                        : row.health === "unreachable" ? "bg-destructive/80"
                        : "bg-white/20"
                      )}
                      style={{ width: `${(row.total / max) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Recently changed */}
        {recent.length > 0 && (
          <section>
            <h4 className="mb-1 flex items-center gap-2 font-headline text-[10px] font-bold uppercase tracking-wider text-primary">
              <Clock className="h-3 w-3" /> Changed in last 7 days
            </h4>
            <div className="space-y-1">
              {recent.map(({ item, domain }, idx) => (
                <div key={`recent-${domain.id}:${item.id}:${idx}`} className="flex items-center gap-2 rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[10px]">
                  <span className={cn("shrink-0 rounded border px-1 text-[8px] uppercase", STATUS_TONE[item.status || "ok"])}>
                    {item.status || "ok"}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
                  <span className="shrink-0 text-[8px] uppercase text-muted-foreground/70">{domain.label}</span>
                  <span className="shrink-0 text-[8px] text-muted-foreground">{formatAgo(item.mtime || 0)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </ScrollArea>
  );
}

function InsightTile({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: number; sub?: string; tone: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 px-2 py-2 font-mono">
      <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground">
        <Icon className={cn("h-3 w-3", tone)} />
        <span>{label}</span>
      </div>
      <p className={cn("mt-1 text-base font-bold", tone)}>{value}</p>
      {sub && <p className="text-[8px] uppercase tracking-wider text-muted-foreground/80">{sub}</p>}
    </div>
  );
}
