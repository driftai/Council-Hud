import "server-only";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { clampText, isStale, redactAgentNames, safeReadText, shortHash } from "../helpers";

// Report File adapter: reads a single JSON or JSONL file of entries (e.g. validation reports,
// council status snapshots, build outputs). Each entry becomes a Skill Nexus item with
// status derived from common fields (ok/level/severity/passed/error).
export const reportFileAdapter: SkillNexusAdapter = {
  type: "reportFile",
  async scan(domain: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot> {
    const cfg = loadCouncilConfig();
    const path = String(domain.source?.path || "").trim();
    const format = String(domain.source?.format || (path.endsWith(".jsonl") ? "jsonl" : "json")).toLowerCase();
    const now = Date.now();

    if (!path) {
      return baseSnapshot(domain, "unreachable", "Source path is empty.");
    }

    const read = await safeReadText(path, cfg.skillNexus.maxFileBytes);
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

    const items: SkillNexusItem[] = [];
    let problemCount = 0;

    for (const entry of entries.slice(0, 200)) {
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
    if (entries.length > 200) warnings.push(`Truncated at 200 entries (file had ${entries.length}).`);
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
  if (entry.passed === true || entry.ok === true || entry.success === true) return "ok";
  return "ok";
}

function extractMeta(entry: any): Record<string, string | number | boolean> {
  const meta: Record<string, string | number | boolean> = {};
  for (const key of ["score", "version", "agent", "kind", "type", "severity", "level", "count"]) {
    const value = entry[key];
    if (typeof value === "string" && value.length < 80) meta[key] = value;
    if (typeof value === "number" && Number.isFinite(value)) meta[key] = value;
    if (typeof value === "boolean") meta[key] = value;
  }
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
