import "server-only";

import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { clampText, isStale, safeReadText, shortHash, stripMarkdownPreview, toRelativePath, walkSkillRoot } from "../helpers";
import { createDedupTracker } from "../dedup";
import { isStructuralFile } from "../structural";
import { buildGlobMatcher } from "../glob-filter";
import { resolveVendor } from "../vendor";

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
    // Dedup tracker — collisions count by (vendor, name, folder). Two formats in the
    // same folder don't dupe; two vendors shipping a same-name skill don't dupe.
    // Backed by `../dedup.ts` so other adapters can use the same policy.
    const dedup = createDedupTracker();
    const warnings: string[] = [];
    let problemCount = 0;

    // Cap: skill roots with many docs (Hermes-style mirrors of dozens of agents) regularly
    // exceed 400. Bumped to 800 to fit those without truncation, while still bounding scan cost.
    const FILE_CAP = 800;
    // Per-domain ignored globs — Hermes mirrors LLM-friendly reference-doc dumps
    // (`references/llms-*.md`) that are megabytes large and not skills. Configurable
    // per domain so any feed can hide its known noise. Falls back to the global
    // skillNexus.ignoredGlobs when the domain doesn't set its own.
    const perDomainGlobs = Array.isArray(domain.source?.ignoredGlobs) ? (domain.source.ignoredGlobs as string[]) : null;
    const isIgnored = buildGlobMatcher(perDomainGlobs || cfg.skillNexus.ignoredGlobs);
    let suppressedStructural = 0;
    let suppressedIgnored = 0;
    for (const file of files.slice(0, FILE_CAP)) {
      const relPath = toRelativePath(file.absPath, rootPath);
      const fileBase = (relPath.split("/").pop() || "").toLowerCase();
      // Per-domain glob exclude — runs before any reading so we save the I/O too.
      if (perDomainGlobs && isIgnored(relPath)) {
        suppressedIgnored += 1;
        continue;
      }
      // Surface canonical SKILL.md always; suppress structural per-folder files entirely.
      // Structural list lives in `../structural.ts`.
      if (file.type !== "skill.md" && isStructuralFile(fileBase)) {
        suppressedStructural += 1;
        continue;
      }
      const read = await safeReadText(file.absPath, cfg.skillNexus.maxFileBytes);

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

      // Duplicate detection delegated to `../dedup.ts`. Policy:
      //   - Only canonical SKILL.md files participate (structural files were already filtered).
      //   - `-evolved` variants are recorded as `variant: true` and excluded from accounting
      //     (the Skill Evolver adapter handles parent/child pairing).
      //   - Vendor namespace (from frontmatter or folder-name prefix via `../vendor.ts`)
      //     distinguishes cross-vendor releases that happen to share a title.
      const folderName = (skillFolder.split("/").pop() || "").toLowerCase();
      const isEvolvedVariant = folderName.endsWith("-evolved");
      const vendor = file.type === "skill.md" ? resolveVendor(read.content, skillFolder) : "";
      const { count: dupeCount } = dedup.record({
        name,
        vendor,
        folder: skillFolder,
        variant: isEvolvedVariant || file.type !== "skill.md" || skillFolder.length === 0,
      });

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
        // Slim meta: drop noisy structural counts (headings, bullets). codeBlocks signals
        // "has examples" — that's the only one worth a pill. Vendor surfaces only when set.
        meta: {
          ...(vendor ? { vendor } : {}),
          ...(preview.homepage ? { homepage: preview.homepage } : {}),
          ...(preview.version ? { version: preview.version } : {}),
          ...(preview.license ? { license: preview.license } : {}),
          ...(preview.requires && preview.requires.length > 0 ? { requiresEnv: preview.requires.join(", ") } : {}),
          ...(typeof preview.codeBlockCount === "number" && preview.codeBlockCount > 0 ? { codeBlocks: preview.codeBlockCount } : {}),
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
        ...(suppressedStructural > 0 ? { suppressedStructural } : {}),
        ...(suppressedIgnored > 0 ? { suppressedIgnored } : {}),
        docCount: items.length - skillCount,
        rootReachable: true,
      },
    };
  },
};
