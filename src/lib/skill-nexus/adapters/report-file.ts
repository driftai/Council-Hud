import "server-only";

import { promises as fs } from "node:fs";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { clampText, isStale, redactAgentNames, safeReadText, shortHash } from "../helpers";

// Read just the last `tailBytes` of a file. For JSONL feeds whose files grow without bound
// (evolution history at 15k+ entries) we don't want to suck the whole thing into memory each
// scan. Returns the tail with the first (likely truncated) line dropped so JSON.parse holds.
async function safeTailRead(path: string, tailBytes: number): Promise<
  { content: string; size: number; mtime: number; tailed: true } | { oversized: true; size: number; mtime: number } | null
> {
  try {
    const stat = await fs.stat(path);
    const size = stat.size;
    const mtime = stat.mtimeMs;
    if (size <= tailBytes) {
      const content = await fs.readFile(path, "utf8");
      return { content, size, mtime, tailed: false } as any;
    }
    const fh = await fs.open(path, "r");
    try {
      const start = size - tailBytes;
      const buf = Buffer.alloc(tailBytes);
      await fh.read(buf, 0, tailBytes, start);
      const raw = buf.toString("utf8");
      // Drop the first line which is almost certainly a partial record.
      const firstNewline = raw.indexOf("\n");
      const content = firstNewline >= 0 ? raw.slice(firstNewline + 1) : raw;
      return { content, size, mtime, tailed: true };
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

// Report File adapter: reads a single JSON or JSONL file of entries (e.g. validation reports,
// council status snapshots, build outputs). Each entry becomes a Skill Nexus item with
// status derived from common fields (ok/level/severity/passed/error).
//
// JSONL feeds can opt into tail-only reads via source.tailKB to handle ever-growing logs
// without loading the whole file each scan.
export const reportFileAdapter: SkillNexusAdapter = {
  type: "reportFile",
  async scan(domain: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot> {
    const cfg = loadCouncilConfig();
    const path = String(domain.source?.path || "").trim();
    const format = String(domain.source?.format || (path.endsWith(".jsonl") ? "jsonl" : "json")).toLowerCase();
    const tailKBSource = domain.source?.tailKB;
    const tailKB = typeof tailKBSource === "number" && tailKBSource > 0 ? tailKBSource : 0;
    const now = Date.now();

    if (!path) {
      return baseSnapshot(domain, "unreachable", "Source path is empty.");
    }

    // For JSONL feeds, default to tail-mode if no explicit tailKB is set — these are append-only
    // time-series files and reading the whole thing is wasteful.
    const effectiveTailKB = tailKB > 0
      ? tailKB
      : (format === "jsonl" ? 512 : 0);

    let read:
      | Awaited<ReturnType<typeof safeReadText>>
      | { content: string; size: number; mtime: number; tailed?: boolean };

    if (effectiveTailKB > 0) {
      read = await safeTailRead(path, effectiveTailKB * 1024) as any;
    } else {
      read = await safeReadText(path, cfg.skillNexus.maxFileBytes);
    }
    if (!read) {
      return baseSnapshot(domain, "unreachable", "Report file not reachable.");
    }
    if ("oversized" in read) {
      return baseSnapshot(domain, "degraded", `Report file oversized (${read.size} bytes).`);
    }

    let entries: any[] = [];
    try {
      if (format === "jsonl") {
        entries = read.content
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } else {
        const parsed = JSON.parse(read.content);
        entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries
          : Array.isArray(parsed?.items) ? parsed.items
          : [parsed];
      }
    } catch (parseError: any) {
      return baseSnapshot(domain, "degraded", `Parse error: ${parseError?.message || "invalid JSON"}`);
    }

    const totalEntries = entries.length;

    // For time-series JSONL (evolution history, judge outputs, etc.) the newest entries
    // are at the end. Slice the tail so the freshest 200 records are what surfaces.
    // domain.source.order can override this if a feed is ordered newest-first.
    const order = String(domain.source?.order || (format === "jsonl" ? "newest-last" : "as-is"));
    const visible = order === "newest-last"
      ? entries.slice(-200).reverse()
      : entries.slice(0, 200);

    const items: SkillNexusItem[] = [];
    let problemCount = 0;

    for (const entry of visible) {
      if (!entry || typeof entry !== "object") continue;
      const rawName = String(entry.name || entry.title || entry.id || entry.skill || entry.key || "entry");
      const name = clampText(redactAgentNames(rawName), 80);
      const description = clampText(redactAgentNames(String(entry.description || entry.summary || entry.message || "")), 200);
      const status = inferStatus(entry);
      if (status !== "ok" && status !== "pending") problemCount += 1;
      const mtime = Number(entry.timestamp || entry.mtime || entry.updatedAt || read.mtime) || read.mtime;
      items.push({
        id: shortHash(`${rawName}|${entry.id || ""}|${entry.severity || ""}`),
        name,
        description,
        mtime,
        status,
        tags: ["report"],
        meta: extractMeta(entry),
      });
    }

    const stale = isStale(read.mtime, 7);
    const warnings: string[] = [];
    if (totalEntries > 200) warnings.push(`Showing ${order === "newest-last" ? "freshest" : "first"} 200 of ${totalEntries} entries.`);
    if (stale) warnings.push("Report file has not been updated in over a week.");

    return {
      id: domain.id,
      label: domain.label,
      type: domain.type,
      enabled: domain.enabled !== false,
      health: items.length === 0 ? "empty" : (problemCount > 0 ? "degraded" : "ok"),
      itemCount: items.length,
      problemCount,
      warnings,
      items,
      generatedAt: now,
      meta: {
        format,
        lastModified: read.mtime,
        rawEntryCount: entries.length,
      },
    };
  },
};

function inferStatus(entry: any): SkillNexusItem["status"] {
  const severity = String(entry.severity || entry.level || "").toLowerCase();
  if (severity === "error" || severity === "fail" || severity === "critical") return "error";
  if (severity === "warn" || severity === "warning") return "stale";
  if (entry.error || entry.failure || entry.failed === true || entry.passed === false) return "error";
  if (entry.pending === true || entry.queued === true) return "pending";
  if (entry.deprecated === true) return "deprecated";
  if (entry.duplicate === true) return "duplicate";
  if (entry.conflict === true) return "conflicted";
  // Evolution-experiment shape: { kept: bool, improvement: number, score: number }
  if (entry.kept === true) return "ok";
  if (entry.kept === false) return "deprecated";
  if (entry.passed === true || entry.ok === true || entry.success === true) return "ok";
  return "ok";
}

function extractMeta(entry: any): Record<string, string | number | boolean> {
  const meta: Record<string, string | number | boolean> = {};
  // Generic + evolution-experiment fields. Numbers are rounded to keep payload tidy.
  for (const key of [
    "score", "version", "agent", "kind", "type", "severity", "level", "count",
    "experiment", "improvement", "kept", "magnitude", "verdict", "judge", "model",
  ]) {
    const value = entry[key];
    if (typeof value === "string" && value.length < 80) meta[key] = value;
    if (typeof value === "number" && Number.isFinite(value)) {
      // Trim noisy floats (0.8123456789 → 0.812).
      meta[key] = Number.isInteger(value) ? value : Math.round(value * 1000) / 1000;
    }
    if (typeof value === "boolean") meta[key] = value;
  }
  // Mutation count signal from evolution records.
  if (Array.isArray(entry.mutations)) meta["mutations"] = entry.mutations.length;
  return meta;
}

function baseSnapshot(
  domain: SkillNexusDomainConfig,
  health: SkillNexusDomainSnapshot["health"],
  warning: string
): SkillNexusDomainSnapshot {
  return {
    id: domain.id,
    label: domain.label,
    type: domain.type,
    enabled: domain.enabled !== false,
    health,
    itemCount: 0,
    problemCount: 0,
    warnings: warning ? [warning] : [],
    items: [],
    generatedAt: Date.now(),
  };
}
