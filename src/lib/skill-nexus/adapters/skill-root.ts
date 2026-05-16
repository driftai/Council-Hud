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

    // Cap: skill roots with many docs (Hermes-style mirrors of dozens of agents) regularly
    // exceed 400. Bumped to 800 to fit those without truncation, while still bounding scan cost.
    const FILE_CAP = 800;
    for (const file of files.slice(0, FILE_CAP)) {
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

      const preview = stripMarkdownPreview(read.content);
      const skillFolder = file.type === "skill.md" ? dirname(relPath) : "";
      const baseName = preview.title || (skillFolder ? skillFolder.split("/").pop() : relPath.split("/").pop()) || relPath;
      const name = clampText(baseName, 80);
      const stale = isStale(read.mtime, 90);

      // Duplicate detection: only flag when the **canonical SKILL.md** of two different
      // skill folders carries the same title (or the same folder name). Don't flag
      // structural per-folder files like _meta.json / evolution_meta.json /
      // DESCRIPTION.md / package.json / openai.yaml / LICENSE.txt — those are
      // expected to repeat once per skill folder by design.
      const STRUCTURAL_FILES = new Set([
        "_meta.json", "evolution_meta.json", "package.json",
        "openai.yaml", "license.txt", "notice.txt", "description.md",
        "readme.md", "index.js", "__init__.py", "tsconfig.json",
      ]);
      const fileBase = (relPath.split("/").pop() || "").toLowerCase();
      const isStructural = STRUCTURAL_FILES.has(fileBase);
      // The evolver clones a parent skill into `<name>-evolved/` while a trial is alive.
      // Both folders carry the same title by design — the Skill Evolver adapter handles
      // the parent/child pairing already, so exclude evolved variants from dupe accounting.
      const folderName = (skillFolder.split("/").pop() || "").toLowerCase();
      const isEvolvedVariant = folderName.endsWith("-evolved");
      // Only canonical skill markers participate in duplicate accounting.
      const eligibleForDupe = file.type === "skill.md" && !isStructural && !isEvolvedVariant;
      const dupeKey = name.toLowerCase();
      const dupeCount = eligibleForDupe
        ? ((seenNames.get(dupeKey) || 0) + 1)
        : 0;
      if (eligibleForDupe) seenNames.set(dupeKey, dupeCount);

      // Missing-description warning per the original spec.
      const missingDescription = file.type === "skill.md" && !preview.description;
      if (missingDescription) {
        warnings.push(`Skill missing description: ${relPath}`);
      }

      let status: SkillNexusItem["status"] = "ok";
      if (dupeCount > 1) {
        status = "duplicate";
        problemCount += 1;
      } else if (stale) {
        status = "stale";
        problemCount += 1;
      } else if (missingDescription) {
        // Soft signal — still ok, but flag it in the tag set.
      }

      const tags = file.type === "skill.md" ? ["skill"] : ["doc"];
      if (missingDescription) tags.push("no-description");
      if ((preview.codeBlockCount || 0) >= 1) tags.push("has-examples");
      if (preview.requires && preview.requires.length > 0) tags.push("requires-env");

      items.push({
        id: shortHash(`${relPath}|${name}`),
        name,
        description: preview.description,
        relativePath: relPath,
        size: read.size,
        mtime: read.mtime,
        hash: shortHash(read.content),
        status,
        tags,
        meta: {
          ...(preview.homepage ? { homepage: preview.homepage } : {}),
          ...(preview.version ? { version: preview.version } : {}),
          ...(preview.license ? { license: preview.license } : {}),
          ...(preview.requires && preview.requires.length > 0 ? { requiresEnv: preview.requires.join(", ") } : {}),
          ...(typeof preview.headingCount === "number" ? { headings: preview.headingCount } : {}),
          ...(typeof preview.codeBlockCount === "number" ? { codeBlocks: preview.codeBlockCount } : {}),
          ...(typeof preview.bulletCount === "number" ? { bullets: preview.bulletCount } : {}),
        },
      });
    }

    if (files.length > FILE_CAP) {
      warnings.push(`Walk truncated at ${FILE_CAP} files — root holds ${files.length} candidate files.`);
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
