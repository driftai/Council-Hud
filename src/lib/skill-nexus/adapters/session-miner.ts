import "server-only";

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { clampText, isStale, safeReadText, shortHash } from "../helpers";

// Session Miner adapter: reads mined skill candidates. Supports either:
//   - source.outputDir: scan all *.json/*.jsonl mined files in a directory
//   - source.outputFile: one JSONL/JSON file
// (Endpoint/command modes are stubbed for now — config can declare them, scan will note them
// as warnings until adapters for those modes ship.)
//
// Each entry surfaces as a candidate skill — name, source session hash, confidence, action,
// timestamp. Raw chat excerpts are NEVER included; only the candidate's metadata.
export const sessionMinerAdapter: SkillNexusAdapter = {
  type: "sessionMiner",
  async scan(domain: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot> {
    const cfg = loadCouncilConfig();
    const outputDir = String(domain.source?.outputDir || "").trim();
    const outputFile = String(domain.source?.outputFile || "").trim();
    const command = String(domain.source?.command || "").trim();
    const endpoint = String(domain.source?.endpoint || "").trim();
    const now = Date.now();
    const warnings: string[] = [];

    if (!outputDir && !outputFile) {
      if (command || endpoint) {
        warnings.push("Command/endpoint modes are configured but not yet supported by this adapter. Add an outputDir or outputFile to start scanning.");
      } else {
        warnings.push("Source must declare outputDir or outputFile.");
      }
      return baseSnapshot(domain, warnings.length ? "unreachable" : "empty", warnings);
    }

    const files: string[] = [];
    if (outputDir) {
      try {
        const entries = await fs.readdir(outputDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          if (!/\.(jsonl?|ndjson)$/i.test(entry.name)) continue;
          files.push(join(outputDir, entry.name));
        }
      } catch {
        warnings.push("outputDir is not reachable.");
        return baseSnapshot(domain, "unreachable", warnings);
      }
    } else if (outputFile) {
      files.push(outputFile);
    }

    if (files.length === 0) {
      return baseSnapshot(domain, "empty", warnings);
    }

    const items: SkillNexusItem[] = [];
    let problemCount = 0;
    let oldestMtime = 0;

    for (const file of files.slice(0, 50)) {
      const read = await safeReadText(file, cfg.skillNexus.maxFileBytes);
      if (!read) {
        warnings.push("One mined output file was unreadable.");
        continue;
      }
      if ("oversized" in read) {
        warnings.push("One mined output file was skipped (oversized).");
        continue;
      }
      oldestMtime = oldestMtime ? Math.min(oldestMtime, read.mtime) : read.mtime;

      const lines = read.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines.slice(0, 200)) {
        let entry: any;
        try { entry = JSON.parse(line); } catch { continue; }
        if (!entry || typeof entry !== "object") continue;

        const candidateName = clampText(String(entry.candidate || entry.name || entry.title || "candidate"), 80);
        const action = String(entry.action || entry.suggestion || "review").toLowerCase();
        const confidence = Number(entry.confidence ?? entry.score ?? 0);
        const sessionHashRaw = String(entry.sessionId || entry.sessionHash || entry.session_id || entry.hash || "");
        const sessionHash = sessionHashRaw ? shortHash(sessionHashRaw) : "";
        const status: SkillNexusItem["status"] =
          action === "create" || action === "promote" ? "candidate"
            : action === "merge" || action === "update" ? "pending"
            : action === "archive" || action === "deprecate" ? "deprecated"
            : "candidate";

        if (status === "deprecated") problemCount += 1;

        items.push({
          id: shortHash(`${candidateName}|${sessionHash}|${entry.timestamp || ""}`),
          name: candidateName,
          // Description is the short reason field, NEVER raw chat. Adapters never propagate
          // free-form excerpts unless the entry explicitly stores a safe-redacted preview.
          description: clampText(String(entry.reason || entry.summary || entry.label || ""), 200),
          mtime: Number(entry.timestamp || read.mtime) || read.mtime,
          status,
          tags: [action, "candidate"],
          meta: {
            confidence: Number.isFinite(confidence) ? Number(confidence.toFixed(2)) : 0,
            ...(sessionHash ? { session: sessionHash } : {}),
            ...(typeof entry.priority === "string" ? { priority: entry.priority } : {}),
          },
        });
      }
    }

    if (items.length > 0 && isStale(oldestMtime, 30)) {
      warnings.push("Mined output hasn't refreshed in over a month — Session Miner may be paused.");
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
      meta: {
        files: files.length,
        candidates: items.length,
        oldestRecord: oldestMtime,
      },
    };
  },
};

function baseSnapshot(
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
