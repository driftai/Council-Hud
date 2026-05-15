import "server-only";

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { clampText, isStale, redactAgentNames, safeReadText, shortHash, toRelativePath } from "../helpers";

// Skill Forge adapter: monitors a forge queue + output dir. Surfaces drafts/candidates/
// promoted skills/failed runs/validation status. Adapter never reads raw session text;
// it ingests forge metadata records only.
export const skillForgeAdapter: SkillNexusAdapter = {
  type: "skillForge",
  async scan(domain: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot> {
    const cfg = loadCouncilConfig();
    const queuePath = String(domain.source?.queuePath || "").trim();
    const outputDir = String(domain.source?.outputDir || "").trim();
    const now = Date.now();
    const warnings: string[] = [];

    if (!queuePath && !outputDir) {
      warnings.push("Skill Forge needs either source.queuePath or source.outputDir.");
      return base(domain, "unreachable", warnings);
    }

    const items: SkillNexusItem[] = [];
    let problemCount = 0;
    let lastForgeActivity = 0;

    // --- Queue file: each line is a forge job record ---
    if (queuePath) {
      const read = await safeReadText(queuePath, cfg.skillNexus.maxFileBytes);
      if (!read) {
        warnings.push("Forge queue file not reachable.");
      } else if ("oversized" in read) {
        warnings.push("Forge queue file oversized; skipped.");
      } else {
        lastForgeActivity = Math.max(lastForgeActivity, read.mtime);
        const lines = read.content
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        for (const line of lines.slice(-100)) {
          let entry: any;
          try { entry = JSON.parse(line); } catch { continue; }
          if (!entry || typeof entry !== "object") continue;

          const name = clampText(redactAgentNames(String(entry.name || entry.candidate || entry.skill || "forge-job")), 80);
          const stateRaw = String(entry.state || entry.status || entry.phase || "pending").toLowerCase();
          let status: SkillNexusItem["status"] = "pending";
          if (stateRaw === "promoted" || stateRaw === "installed" || stateRaw === "complete" || stateRaw === "done") status = "ok";
          else if (stateRaw === "failed" || stateRaw === "error" || stateRaw === "rejected") { status = "error"; problemCount += 1; }
          else if (stateRaw === "draft" || stateRaw === "candidate" || stateRaw === "review") status = "candidate";
          else if (stateRaw === "archived" || stateRaw === "deprecated") { status = "deprecated"; problemCount += 1; }

          items.push({
            id: shortHash(`${name}|${entry.id || ""}|${entry.timestamp || ""}`),
            name,
            description: clampText(redactAgentNames(String(entry.reason || entry.summary || entry.note || "")), 200),
            mtime: Number(entry.timestamp || entry.updatedAt || read.mtime) || read.mtime,
            status,
            tags: ["forge", stateRaw],
            meta: {
              state: stateRaw,
              ...(typeof entry.priority === "string" ? { priority: entry.priority } : {}),
              ...(typeof entry.confidence === "number" ? { confidence: Number(entry.confidence.toFixed(2)) } : {}),
            },
          });
        }
      }
    }

    // --- Output dir: each subdir is a forged skill ---
    if (outputDir) {
      try {
        const entries = await fs.readdir(outputDir, { withFileTypes: true });
        for (const entry of entries.slice(0, 100)) {
          if (entry.name.startsWith(".")) continue;
          const fullPath = join(outputDir, entry.name);
          let stat: import("node:fs").Stats;
          try { stat = await fs.stat(fullPath); } catch { continue; }
          if (!stat.isDirectory() && !stat.isFile()) continue;
          lastForgeActivity = Math.max(lastForgeActivity, stat.mtimeMs);
          const rel = toRelativePath(fullPath, outputDir);
          const stale = isStale(stat.mtimeMs, 30);
          const skillMdPath = stat.isDirectory() ? join(fullPath, "SKILL.md") : "";
          let hasSkillMd = false;
          if (skillMdPath) {
            try {
              const skillStat = await fs.stat(skillMdPath);
              hasSkillMd = skillStat.isFile();
            } catch { hasSkillMd = false; }
          }
          const status: SkillNexusItem["status"] = stat.isDirectory() && !hasSkillMd ? "error" : (stale ? "stale" : "ok");
          if (status !== "ok") problemCount += 1;
          items.push({
            id: shortHash(`output|${rel}`),
            name: clampText(rel, 80),
            description: stat.isDirectory()
              ? (hasSkillMd ? "Forged skill folder" : "Forge output missing SKILL.md")
              : "Forge output artifact",
            relativePath: rel,
            size: stat.size,
            mtime: stat.mtimeMs,
            status,
            tags: ["forge", stat.isDirectory() ? "output-folder" : "output-file"],
          });
        }
      } catch {
        warnings.push("Forge outputDir is not reachable.");
      }
    }

    if (lastForgeActivity && isStale(lastForgeActivity, 14)) {
      warnings.push("No forge activity in 2+ weeks.");
    }

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
      meta: { lastForgeActivity },
    };
  },
};

function base(
  domain: SkillNexusDomainConfig,
  health: SkillNexusDomainSnapshot["health"],
  warnings: string[]
): SkillNexusDomainSnapshot {
  return {
    id: domain.id,
    label: domain.label,
    type: domain.type,
    enabled: domain.enabled !== false,
    health,
    itemCount: 0,
    problemCount: 0,
    warnings,
    items: [],
    generatedAt: Date.now(),
  };
}
