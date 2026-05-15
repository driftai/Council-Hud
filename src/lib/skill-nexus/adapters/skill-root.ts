import "server-only";

import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { clampText, isStale, safeReadText, shortHash, stripMarkdownPreview, toRelativePath, walkSkillRoot } from "../helpers";

// Skill Root adapter: scans a directory tree for SKILL.md / skill.md / *.md / *.json metadata
// files. Treats SKILL.md as authoritative; other markdown files are docs. Cap on depth +
// per-file size + per-domain item count to keep scans cheap.
export const skillRootAdapter: SkillNexusAdapter = {
  type: "skillRoot",
  async scan(domain: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot> {
    const cfg = loadCouncilConfig();
    const rootPath = String(domain.source?.path || "").trim();
    const now = Date.now();
    if (!rootPath) {
      return {
        id: domain.id,
        label: domain.label,
        type: domain.type,
        enabled: domain.enabled !== false,
        health: "unreachable",
        itemCount: 0,
        problemCount: 0,
        warnings: ["Source path is empty. Set source.path in council.config.local.json."],
        items: [],
        generatedAt: now,
      };
    }

    let rootStat: import("node:fs").Stats | null = null;
    try {
      rootStat = await fs.stat(rootPath);
    } catch {
      return {
        id: domain.id,
        label: domain.label,
        type: domain.type,
        enabled: domain.enabled !== false,
        health: "unreachable",
        itemCount: 0,
        problemCount: 0,
        warnings: ["Configured root path is not reachable on this machine."],
        items: [],
        generatedAt: now,
      };
    }
    if (!rootStat.isDirectory()) {
      return {
        id: domain.id,
        label: domain.label,
        type: domain.type,
        enabled: domain.enabled !== false,
        health: "unreachable",
        itemCount: 0,
        problemCount: 0,
        warnings: ["Configured root path is not a directory."],
        items: [],
        generatedAt: now,
      };
    }

    const files = await walkSkillRoot(rootPath, {
      allowedExtensions: cfg.skillNexus.allowedExtensions,
      maxDepth: 4,
    });

    const items: SkillNexusItem[] = [];
    const seenNames = new Map<string, number>();
    const warnings: string[] = [];
    let problemCount = 0;

    for (const file of files.slice(0, 400)) {
      const read = await safeReadText(file.absPath, cfg.skillNexus.maxFileBytes);
      const relPath = toRelativePath(file.absPath, rootPath);

      if (!read) {
        items.push({
          id: shortHash(relPath),
          name: relPath,
          relativePath: relPath,
          status: "error",
          tags: [file.type],
        });
        problemCount += 1;
        continue;
      }

      if ("oversized" in read) {
        items.push({
          id: shortHash(relPath),
          name: relPath,
          relativePath: relPath,
          size: read.size,
          mtime: read.mtime,
          status: "oversized",
          tags: [file.type],
        });
        problemCount += 1;
        continue;
      }

      const { title, description } = stripMarkdownPreview(read.content);
      const skillFolder = file.type === "skill.md" ? dirname(relPath) : "";
      const baseName = title || (skillFolder ? skillFolder.split("/").pop() : relPath.split("/").pop()) || relPath;
      const name = clampText(baseName, 80);
      const stale = isStale(read.mtime, 90);

      const dupeKey = name.toLowerCase();
      const dupeCount = (seenNames.get(dupeKey) || 0) + 1;
      seenNames.set(dupeKey, dupeCount);

      let status: SkillNexusItem["status"] = "ok";
      if (dupeCount > 1) {
        status = "duplicate";
        problemCount += 1;
      } else if (stale) {
        status = "stale";
        problemCount += 1;
      }

      items.push({
        id: shortHash(`${relPath}|${name}`),
        name,
        description,
        relativePath: relPath,
        size: read.size,
        mtime: read.mtime,
        hash: shortHash(read.content),
        status,
        tags: file.type === "skill.md" ? ["skill"] : ["doc"],
      });
    }

    if (files.length > 400) {
      warnings.push(`Walk truncated at 400 files — root holds ${files.length} candidate files.`);
    }

    const skillCount = items.filter((item) => item.tags?.includes("skill")).length;

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
        skillCount,
        docCount: items.length - skillCount,
        rootReachable: true,
      },
    };
  },
};
