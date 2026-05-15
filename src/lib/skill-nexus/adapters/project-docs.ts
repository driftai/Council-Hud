import "server-only";

import { promises as fs } from "node:fs";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { clampText, isStale, safeReadText, shortHash, stripMarkdownPreview, toRelativePath, walkSkillRoot } from "../helpers";

// Project Docs adapter: same shape as skillRoot but tagged "doc" and uses a shallower walk —
// these are the per-project skill docs that live alongside the code (NEXUS_SKILLS.md, etc.)
// rather than a standalone skill library.
export const projectDocsAdapter: SkillNexusAdapter = {
  type: "projectDocs",
  async scan(domain: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot> {
    const cfg = loadCouncilConfig();
    const rootPath = String(domain.source?.path || "").trim();
    const now = Date.now();

    if (!rootPath) {
      return base(domain, "unreachable", ["Source path is empty."]);
    }
    try {
      const stat = await fs.stat(rootPath);
      if (!stat.isDirectory()) return base(domain, "unreachable", ["Source path is not a directory."]);
    } catch {
      return base(domain, "unreachable", ["Source path not reachable."]);
    }

    const files = await walkSkillRoot(rootPath, {
      allowedExtensions: cfg.skillNexus.allowedExtensions,
      maxDepth: 2,
    });

    const items: SkillNexusItem[] = [];
    let problemCount = 0;
    for (const file of files.slice(0, 200)) {
      const read = await safeReadText(file.absPath, cfg.skillNexus.maxFileBytes);
      const relPath = toRelativePath(file.absPath, rootPath);
      if (!read) {
        problemCount += 1;
        items.push({ id: shortHash(relPath), name: relPath, relativePath: relPath, status: "error", tags: ["doc"] });
        continue;
      }
      if ("oversized" in read) {
        problemCount += 1;
        items.push({ id: shortHash(relPath), name: relPath, relativePath: relPath, size: read.size, mtime: read.mtime, status: "oversized", tags: ["doc"] });
        continue;
      }
      const { title, description } = stripMarkdownPreview(read.content);
      const stale = isStale(read.mtime, 120);
      if (stale) problemCount += 1;
      items.push({
        id: shortHash(`${relPath}|${title}`),
        name: clampText(title || relPath.split("/").pop() || relPath, 80),
        description,
        relativePath: relPath,
        size: read.size,
        mtime: read.mtime,
        hash: shortHash(read.content),
        status: stale ? "stale" : "ok",
        tags: ["doc"],
      });
    }

    return {
      id: domain.id,
      label: domain.label,
      type: domain.type,
      enabled: domain.enabled !== false,
      health: items.length === 0 ? "empty" : (problemCount > 0 ? "degraded" : "ok"),
      itemCount: items.length,
      problemCount,
      warnings: [],
      items,
      generatedAt: now,
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
