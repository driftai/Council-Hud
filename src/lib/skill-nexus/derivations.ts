// Health derivations for the Skill Nexus Issues tab. The raw `problemCount` /
// `warnings` lists only catch per-item failures and adapter-emitted notices.
// To surface *system-level* bottlenecks (capacity pressure, stale heartbeats,
// cross-subsystem health) we synthesize additional signals here, derived
// from the same snapshot the API already returns.
//
// Design pattern follows Google SRE's Four Golden Signals — we already cover
// Errors (item problems) and partially Saturation (truncation warnings); this
// module fills in proper Saturation + Activity/heartbeat signals and rolls them
// into cross-system "where is the bottleneck" rows.
//
// Pure functions, server- or client-safe. Caller passes the raw report.

// Inline-shape types — keep derivations client-importable. `types.ts` is
// `server-only` (it imports the secrets-aware council-config), so the client-
// rendered IssuesPanel can't reach it directly. These structural duplicates
// match the actual snapshot shape; TypeScript's structural typing means the
// real DomainSnapshot/SkillNexusReport pass through fine.
type SkillItem = {
  status?: string;
  mtime?: number;
};
type DomainSnapshot = {
  id: string;
  label: string;
  type?: string;
  health: string;
  itemCount: number;
  problemCount?: number;
  warnings?: string[];
  items: SkillItem[];
  meta?: Record<string, unknown>;
};
type SkillNexusReport = {
  domains: DomainSnapshot[];
};

export type Severity = "ok" | "info" | "warning" | "critical";

export type SaturationSignal = {
  domainId: string;
  domainLabel: string;
  // Free-text label of what the signal measures (e.g. "skill files").
  what: string;
  // Numeric form when meaningful — used to render a fill bar.
  used: number;
  capacity: number;
  // Optional human-readable note for cases the bar alone can't convey.
  note?: string;
  severity: Severity;
};

export type HeartbeatSignal = {
  domainId: string;
  domainLabel: string;
  // Age of the most recent activity in milliseconds (Date.now() - lastMtime).
  ageMs: number;
  // Human-readable interpretation of the age relative to expected cadence.
  status: string;
  severity: Severity;
};

export type BottleneckSignal = {
  id: string;
  label: string;
  // 1-line description of the cross-system signal.
  detail: string;
  severity: Severity;
};

// File-cap for skill-root adapters — must mirror the FILE_CAP constant in
// adapters/skill-root.ts. If that constant moves into a shared module someday,
// import from there.
const FILE_CAP = 800;

// Per-domain expected cadence in hours. When a domain hasn't had any item
// activity within this window, we mark it as "stale" with a warning. Tuned
// from observed behaviour:
//   - autoresearch ticks every ~minute, but new entries hit history.jsonl in
//     bursts — 72h is the sane warning threshold rather than the literal cadence
//   - skill-forge-pipeline domain is configured to read the *rotated* archive
//     (.log.1), which is always older than the active log by design — 30d
//   - skill libraries shift on the scale of months, not days
//   - runtime-hooks and per-vendor mirrors almost never change
const EXPECTED_CADENCE_HOURS: Record<string, number> = {
  "skill-evolver": 72,
  "evolution-history": 72,
  "experiment-results": 72,
  "skill-forge-pipeline": 6,
  "session-miner": 24 * 14,
  "council-journal-feed": 24 * 7,
  "openclaw-skills": 24 * 60,
  "claude-skills": 24 * 90,
  "codex-skills": 24 * 90,
  "gemini-skills": 24 * 90,
  "hermes-skills": 24 * 60,
  "runtime-hooks": 24 * 180,
};

// Parse the X-of-Y pattern from a truncation warning into numeric components.
// Examples:
//   "Showing newest 60 of 74097 experiments." → { shown: 60, total: 74097 }
//   "Showing freshest 200 of 1244 entries."   → { shown: 200, total: 1244 }
//   "Walk truncated at 800 files — root holds 950 candidate files."
//                                            → { shown: 800, total: 950 }
function parseTruncationWarning(text: string): { shown: number; total: number } | null {
  const a = text.match(/(\d[\d,]*)\s*of\s*(\d[\d,]*)/i);
  if (a) {
    return { shown: Number(a[1].replace(/,/g, "")), total: Number(a[2].replace(/,/g, "")) };
  }
  const b = text.match(/truncated at\s*(\d[\d,]*)[^\d]+(\d[\d,]*)/i);
  if (b) {
    return { shown: Number(b[1].replace(/,/g, "")), total: Number(b[2].replace(/,/g, "")) };
  }
  return null;
}

// Find the freshest item mtime across a domain's items. Returns 0 when nothing
// has a usable mtime (some adapters don't supply per-item timestamps).
function freshestItemMtime(domain: DomainSnapshot): number {
  let max = 0;
  for (const item of domain.items) {
    if (item.mtime && item.mtime > max) max = item.mtime;
  }
  return max;
}

export function deriveSaturation(report: SkillNexusReport): SaturationSignal[] {
  const out: SaturationSignal[] = [];
  for (const domain of report.domains) {
    // 1. Adapter-emitted truncation warnings expose a real X-of-Y.
    for (const warning of domain.warnings || []) {
      const t = parseTruncationWarning(warning);
      if (!t || t.total <= 0) continue;
      const ratio = t.shown / t.total;
      const sev: Severity = ratio < 0.05 ? "info" : ratio < 0.2 ? "warning" : "critical";
      out.push({
        domainId: domain.id,
        domainLabel: domain.label,
        what: warning.replace(/\s*\([^)]*\)\s*$/, "").trim(),
        used: t.shown,
        capacity: t.total,
        severity: sev,
      });
    }

    // 2. Skill-root domains have an implicit FILE_CAP of 800. Anything over
    //    560 (70% full) is worth surfacing because the next adapter run risks
    //    silent truncation if the library keeps growing.
    if (domain.type === "skillRoot" && domain.itemCount > 0) {
      const used = domain.itemCount;
      const ratio = used / FILE_CAP;
      if (ratio >= 0.7) {
        out.push({
          domainId: domain.id,
          domainLabel: domain.label,
          what: "skill walk cap",
          used,
          capacity: FILE_CAP,
          severity: ratio >= 0.95 ? "critical" : "warning",
        });
      }
    }
  }
  return out;
}

export function deriveHeartbeats(report: SkillNexusReport): HeartbeatSignal[] {
  const out: HeartbeatSignal[] = [];
  const now = Date.now();
  for (const domain of report.domains) {
    if (domain.health === "unreachable") {
      out.push({
        domainId: domain.id,
        domainLabel: domain.label,
        ageMs: 0,
        status: "unreachable",
        severity: "critical",
      });
      continue;
    }
    if (domain.itemCount === 0) continue;
    const freshest = freshestItemMtime(domain);
    if (freshest === 0) continue;
    const ageMs = now - freshest;
    const expectedHours = EXPECTED_CADENCE_HOURS[domain.id] ?? 24 * 7;
    const cadenceMs = expectedHours * 3_600_000;
    let severity: Severity = "ok";
    if (ageMs > cadenceMs * 3) severity = "critical";
    else if (ageMs > cadenceMs) severity = "warning";
    else if (ageMs > cadenceMs * 0.5) severity = "info";
    if (severity === "ok") continue; // healthy heartbeat — no need to surface
    out.push({
      domainId: domain.id,
      domainLabel: domain.label,
      ageMs,
      status: severity === "critical" ? "very stale" : severity === "warning" ? "stale" : "aging",
      severity,
    });
  }
  return out;
}

export function deriveBottlenecks(report: SkillNexusReport): BottleneckSignal[] {
  const out: BottleneckSignal[] = [];
  const byId = new Map(report.domains.map((d) => [d.id, d]));

  // 1. Skill Evolver kept-rate signal — when the loop has many orphan/error
  //    items the pairing pipeline is unhealthy.
  const evolver = byId.get("skill-evolver");
  if (evolver) {
    const orphans = evolver.items.filter((it) => it.status === "missing").length;
    const errors = evolver.items.filter((it) => it.status === "error").length;
    const stale = evolver.items.filter((it) => it.status === "stale").length;
    const bad = orphans + errors + stale;
    if (bad > 0) {
      const sev: Severity = bad >= 10 ? "critical" : bad >= 3 ? "warning" : "info";
      out.push({
        id: "evolver-pairing",
        label: "Skill Evolver pairing",
        detail: `${orphans} orphan · ${errors} error · ${stale} stale evolved skills awaiting reconciliation`,
        severity: sev,
      });
    }
  }

  // 2. Experiment kept-rate — extremely low kept rates over a huge trial space
  //    indicate convergence, not a bug per se. We surface as info so it's
  //    visible without alarming.
  const experiments = byId.get("experiment-results");
  if (experiments && experiments.meta && typeof (experiments.meta as any).keptRate === "number") {
    const keptRate = (experiments.meta as any).keptRate as number;
    if (keptRate >= 0 && keptRate < 0.01) {
      out.push({
        id: "experiment-kept-rate",
        label: "Autoresearch convergence",
        detail: `Kept rate ${(keptRate * 100).toFixed(2)}% — incumbent dominates, magnitude may need raising`,
        severity: "info",
      });
    }
  }

  // 3. Forge pipeline freshness — Forge is supposed to run hourly. If the
  //    most recent log line is much older than that, the cron likely stopped.
  const forge = byId.get("skill-forge-pipeline");
  if (forge && forge.items.length > 0) {
    const freshest = freshestItemMtime(forge);
    const ageH = (Date.now() - freshest) / 3_600_000;
    if (ageH > 6) {
      out.push({
        id: "forge-cron",
        label: "Skill Forge cron",
        detail: `Last pipeline log line ${ageH.toFixed(1)}h old — cron may have stalled`,
        severity: ageH > 24 ? "critical" : "warning",
      });
    }
  }

  // 4. Session-miner check — if the miner's outputs haven't refreshed in
  //    over a week, the daily cron is likely broken.
  const miner = byId.get("session-miner");
  if (miner && miner.items.length > 0) {
    const freshest = freshestItemMtime(miner);
    const ageD = (Date.now() - freshest) / 86_400_000;
    if (ageD > 7) {
      out.push({
        id: "miner-cron",
        label: "Session Miner cron",
        detail: `Last mining cycle ${ageD.toFixed(1)} days ago — investigate session-miner-cron logs`,
        severity: ageD > 14 ? "critical" : "warning",
      });
    }
  }

  // 5. Any domain stuck in `unreachable` health — the adapter couldn't open
  //    its source path. Highest-priority bottleneck.
  for (const domain of report.domains) {
    if (domain.health === "unreachable") {
      out.push({
        id: `unreachable-${domain.id}`,
        label: domain.label,
        detail: "Adapter could not reach this domain's source.",
        severity: "critical",
      });
    }
  }

  return out;
}

// Format an age in ms as "Nh / Nd ago" for compact pill display.
export function formatAge(ms: number): string {
  if (ms <= 0) return "now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}
