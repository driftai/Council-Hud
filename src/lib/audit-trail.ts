import "server-only";

import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";

import { loadCouncilConfig } from "@/lib/council-config";
import { redactAgentNames } from "@/lib/skill-nexus/helpers";

// Strip absolute home paths from log lines. Audit workers cite full filesystem paths in
// their messages ("Fixed: /home/<user>/.openclaw/openclaw.json") which would leak the WSL
// username when surfaced in the HUD. Replace `/home/<anything>/` and Windows-side
// `C:\Users\<anything>\` with a tilde so the operational signal stays but the user is hidden.
function scrubPaths(text: string): string {
  if (!text) return text;
  return text
    .replace(/\/home\/[^/\s"']+/g, "~")
    .replace(/C:[\\\/]Users[\\\/][^\\\/\s"']+/gi, "~");
}

// Audit Trail: surfaces operational audit logs produced by background workers — environment
// audits, config drift checks, alert-config sentinel runs, cleanup sweeps, etc. Reads from
// the workspace logs dir, tails recent activity, and pulls verdict-style lines into a feed.
//
// Privacy: log lines pass through `redactAgentNames` because audit logs occasionally cite
// agent names in their context. Filenames are surfaced as basenames only.

export type AuditEntry = {
  source: string; // log file basename
  ts: number; // best-effort timestamp from line prefix or file mtime
  level: "info" | "warn" | "error" | "ok";
  message: string;
};

export type AuditSnapshot = {
  available: boolean;
  totalLogs: number;
  activeLogs: number; // files updated in last 24h
  entries: AuditEntry[];
  lastActivity: number;
  bySource: Array<{ source: string; entries: number; lastTs: number; level: "info" | "warn" | "error" | "ok" }>;
  source: string;
};

const EMPTY: AuditSnapshot = {
  available: false,
  totalLogs: 0,
  activeLogs: 0,
  entries: [],
  lastActivity: 0,
  bySource: [],
  source: "unavailable",
};

const TIMESTAMP_PATTERNS = [
  /^\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/,
  /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/,
  /^\[(\d{2}:\d{2}:\d{2})\]/,
];

function parseTs(line: string, fileMtime: number): number {
  for (const re of TIMESTAMP_PATTERNS) {
    const m = line.match(re);
    if (m) {
      const parsed = Date.parse(m[1].includes("T") || m[1].includes("-") ? m[1] : `1970-01-01T${m[1]}`);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed / 1000);
    }
  }
  return Math.floor(fileMtime / 1000);
}

function inferLevel(line: string): AuditEntry["level"] {
  const lower = line.toLowerCase();
  if (/\b(error|fail|critical|cannot|denied|missing|broken)\b/.test(lower)) return "error";
  if (/\b(warn|warning|degraded|stale|conflict|skipped)\b/.test(lower)) return "warn";
  if (/\b(ok|fixed|repaired|complete|success|passed|done)\b/.test(lower)) return "ok";
  return "info";
}

// Read just the tail of a text log so we don't slurp gigabyte-sized rotating files.
async function readTail(path: string, tailBytes = 16 * 1024): Promise<{ content: string; mtime: number } | null> {
  try {
    const stat = await fs.stat(path);
    if (stat.size <= tailBytes) {
      const content = await fs.readFile(path, "utf8");
      return { content, mtime: stat.mtimeMs };
    }
    const fh = await fs.open(path, "r");
    try {
      const buf = Buffer.alloc(tailBytes);
      await fh.read(buf, 0, tailBytes, stat.size - tailBytes);
      const raw = buf.toString("utf8");
      const first = raw.indexOf("\n");
      const content = first >= 0 ? raw.slice(first + 1) : raw;
      return { content, mtime: stat.mtimeMs };
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

export async function getAuditSnapshot(): Promise<AuditSnapshot> {
  const cfg = loadCouncilConfig();
  // Workspace logs dir lives next to data/ in the openclaw workspace.
  const dataDir = dirname(cfg.smartFallback.healthFile);
  const workspaceDir = dirname(dirname(dataDir));
  const logsDir = join(workspaceDir, "logs");

  let names: import("node:fs").Dirent[];
  try {
    names = await fs.readdir(logsDir, { withFileTypes: true });
  } catch {
    return EMPTY;
  }

  // Pick audit-relevant log files. Exclude rotated/gz archives — only tail the live one.
  const auditFiles = names
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) =>
      /audit|sentinel|review|verdict/i.test(n) &&
      !/\.(gz|zip|bz2)$/i.test(n) &&
      !/\.\d+$/.test(n) // skip rotated suffixes like ".1", ".2"
    );

  const now = Date.now();
  const oneDayAgo = now - 86_400_000;

  const entries: AuditEntry[] = [];
  const bySourceMap = new Map<string, { entries: number; lastTs: number; level: AuditEntry["level"] }>();
  let lastActivity = 0;
  let activeLogs = 0;

  for (const name of auditFiles.slice(0, 12)) {
    const path = join(logsDir, name);
    const tail = await readTail(path);
    if (!tail) continue;
    if (tail.mtime >= oneDayAgo) activeLogs += 1;
    lastActivity = Math.max(lastActivity, tail.mtime);

    const lines = tail.content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-20); // last 20 lines from each

    let fileEntries = 0;
    let worstLevel: AuditEntry["level"] = "info";
    let lastTs = Math.floor(tail.mtime / 1000);

    for (const line of lines) {
      const ts = parseTs(line, tail.mtime);
      const level = inferLevel(line);
      if (level === "error" || (level === "warn" && worstLevel === "info") || (level === "ok" && worstLevel === "info")) {
        worstLevel = level;
      }
      entries.push({
        source: name,
        ts,
        level,
        message: scrubPaths(redactAgentNames(line.slice(0, 240))),
      });
      lastTs = Math.max(lastTs, ts);
      fileEntries += 1;
    }
    if (fileEntries > 0) {
      bySourceMap.set(name, { entries: fileEntries, lastTs, level: worstLevel });
    }
  }

  // Sort entries newest-first.
  entries.sort((a, b) => b.ts - a.ts);

  const bySource = Array.from(bySourceMap.entries())
    .map(([source, info]) => ({ source, ...info }))
    .sort((a, b) => b.lastTs - a.lastTs);

  return {
    available: true,
    totalLogs: auditFiles.length,
    activeLogs,
    entries: entries.slice(0, 120),
    lastActivity,
    bySource,
    source: basename(logsDir),
  };
}
