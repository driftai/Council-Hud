import "server-only";

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { clampText, isStale, safeReadText, shortHash, stripMarkdownPreview, toRelativePath } from "../helpers";

// Skill Evolver adapter: surfaces evolved-skill relationships, in-progress evolutions, and
// (when present) genome state. Unlike Skill Forge, an evolver produces *paired* artifacts —
// each evolved skill points back to a parent skill. We track that lineage in item.meta.
//
// Source config (all optional, declare whichever exists locally):
//   - skillsDir:    directory holding both parent and evolved skill folders
//   - evolvedSuffix: marker that distinguishes evolved folders (default "-evolved")
//   - statePath:    JSON of current evolution state / best genome / pending runs
//   - appliedPath:  JSON of last applied genome
//   - logPath:      optional JSONL of run history
export const skillEvolverAdapter: SkillNexusAdapter = {
  type: "skillEvolver",
  async scan(domain: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot> {
    const cfg = loadCouncilConfig();
    const skillsDir = String(domain.source?.skillsDir || domain.source?.path || "").trim();
    const evolvedSuffix = String(domain.source?.evolvedSuffix || "-evolved");
    const statePath = String(domain.source?.statePath || "").trim();
    const appliedPath = String(domain.source?.appliedPath || "").trim();
    const logPath = String(domain.source?.logPath || "").trim();
    const now = Date.now();
    const warnings: string[] = [];

    if (!skillsDir && !statePath && !appliedPath && !logPath) {
      warnings.push("Skill Evolver needs at least source.skillsDir, source.statePath, source.appliedPath, or source.logPath.");
      return base(domain, "unreachable", warnings);
    }

    const items: SkillNexusItem[] = [];
    let problemCount = 0;
    let lastEvolutionActivity = 0;

    // --- Pairing pass: walk skillsDir and pair evolved dirs with their parents ---
    if (skillsDir) {
      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = await fs.readdir(skillsDir, { withFileTypes: true });
      } catch {
        warnings.push("skillsDir is not reachable.");
      }

      const allDirs = new Set(
        entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name)
      );
      const evolvedDirs = Array.from(allDirs).filter((name) => name.endsWith(evolvedSuffix));

      for (const evolvedName of evolvedDirs.slice(0, 200)) {
        const parentName = evolvedName.slice(0, -evolvedSuffix.length);
        const evolvedPath = join(skillsDir, evolvedName);
        const parentExists = allDirs.has(parentName);

        let stat: import("node:fs").Stats | null = null;
        try { stat = await fs.stat(evolvedPath); } catch { stat = null; }
        if (stat) lastEvolutionActivity = Math.max(lastEvolutionActivity, stat.mtimeMs);

        // Per-evolution metadata: SKILL.md + evolution_meta.json if present.
        const skillMdPath = join(evolvedPath, "SKILL.md");
        const metaPath = join(evolvedPath, "evolution_meta.json");
        const skillRead = await safeReadText(skillMdPath, cfg.skillNexus.maxFileBytes);
        const hasSkillMd = !!skillRead && !("oversized" in skillRead);
        let title = "";
        let description = "";
        if (skillRead && !("oversized" in skillRead)) {
          const preview = stripMarkdownPreview(skillRead.content);
          title = preview.title;
          description = preview.description;
        }

        let scoreDelta: number | null = null;
        let evolutionTimestamp: number | null = null;
        let genomeId: string = "";
        const metaRead = await safeReadText(metaPath, cfg.skillNexus.maxFileBytes);
        if (metaRead && !("oversized" in metaRead)) {
          try {
            const parsed = JSON.parse(metaRead.content);
            scoreDelta = Number(parsed?.scoreDelta ?? parsed?.score_delta ?? parsed?.improvement ?? NaN);
            evolutionTimestamp = Number(parsed?.timestamp ?? parsed?.applied_at ?? parsed?.evolved_at ?? NaN);
            genomeId = String(parsed?.genome ?? parsed?.genomeId ?? parsed?.id ?? "");
          } catch {
            warnings.push(`evolution_meta.json parse error in ${evolvedName}.`);
          }
        }

        const stale = stat && isStale(stat.mtimeMs, 60);
        let status: SkillNexusItem["status"] = "ok";
        if (!hasSkillMd) { status = "error"; problemCount += 1; }
        else if (!parentExists) { status = "missing"; problemCount += 1; }
        else if (stale) { status = "stale"; problemCount += 1; }

        items.push({
          id: shortHash(`evolver|${evolvedName}|${genomeId}`),
          name: clampText(title || parentName, 80),
          description: clampText(description || (parentExists ? `Evolved from ${parentName}` : "Evolved skill (parent missing)"), 200),
          relativePath: toRelativePath(evolvedPath, skillsDir),
          mtime: evolutionTimestamp || stat?.mtimeMs || 0,
          status,
          tags: ["evolved", parentExists ? "paired" : "orphan"],
          meta: {
            parent: parentName,
            parentPresent: parentExists,
            ...(Number.isFinite(scoreDelta as number) ? { scoreDelta: Number((scoreDelta as number).toFixed(3)) } : {}),
            ...(genomeId ? { genome: genomeId.slice(0, 12) } : {}),
            hasSkillMd,
          },
        });
      }
    }

    // --- Optional state.json: surfaces current best-score / pending evolutions ---
    if (statePath) {
      const read = await safeReadText(statePath, cfg.skillNexus.maxFileBytes);
      if (read && !("oversized" in read)) {
        lastEvolutionActivity = Math.max(lastEvolutionActivity, read.mtime);
        try {
          const parsed = JSON.parse(read.content);
          const bestScore = Number(parsed?.bestScore ?? parsed?.best_score ?? NaN);
          const pending = Number(parsed?.pending ?? parsed?.pendingCount ?? (Array.isArray(parsed?.queue) ? parsed.queue.length : NaN));
          const lastRun = Number(parsed?.lastRun ?? parsed?.last_run ?? parsed?.timestamp ?? read.mtime);
          if (Number.isFinite(bestScore) || Number.isFinite(pending)) {
            items.push({
              id: shortHash(`evolver|state|${lastRun}`),
              name: "Evolver state",
              description: clampText(
                [
                  Number.isFinite(bestScore) ? `best score ${(bestScore as number).toFixed(3)}` : "",
                  Number.isFinite(pending) ? `${pending} pending` : "",
                ].filter(Boolean).join(" · "),
                200
              ),
              mtime: lastRun || read.mtime,
              status: "pending",
              tags: ["evolver-state"],
              meta: {
                ...(Number.isFinite(bestScore) ? { bestScore: Number((bestScore as number).toFixed(3)) } : {}),
                ...(Number.isFinite(pending) ? { pending } : {}),
              },
            });
          }
        } catch {
          warnings.push("state.json parse error.");
        }
      } else if (read && "oversized" in read) {
        warnings.push("state.json oversized; skipped.");
      } else {
        warnings.push("state.json configured but not reachable.");
      }
    }

    // --- Optional appliedPath: last applied genome ---
    if (appliedPath) {
      const read = await safeReadText(appliedPath, cfg.skillNexus.maxFileBytes);
      if (read && !("oversized" in read)) {
        lastEvolutionActivity = Math.max(lastEvolutionActivity, read.mtime);
        try {
          const parsed = JSON.parse(read.content);
          const appliedAt = Number(parsed?.appliedAt ?? parsed?.timestamp ?? read.mtime);
          const score = Number(parsed?.score ?? parsed?.bestScore ?? NaN);
          items.push({
            id: shortHash(`evolver|applied|${appliedAt}`),
            name: "Last applied genome",
            description: Number.isFinite(score) ? `score ${(score as number).toFixed(3)}` : "applied genome",
            mtime: appliedAt,
            status: isStale(appliedAt, 14) ? "stale" : "ok",
            tags: ["evolver-applied"],
            meta: {
              ...(Number.isFinite(score) ? { score: Number((score as number).toFixed(3)) } : {}),
              ...(parsed?.genome ? { genome: String(parsed.genome).slice(0, 12) } : {}),
            },
          });
          if (isStale(appliedAt, 14)) problemCount += 1;
        } catch {
          warnings.push("applied_genome.json parse error.");
        }
      }
    }

    // --- Optional logPath: append run history entries ---
    if (logPath) {
      const read = await safeReadText(logPath, cfg.skillNexus.maxFileBytes);
      if (read && !("oversized" in read)) {
        lastEvolutionActivity = Math.max(lastEvolutionActivity, read.mtime);
        const lines = read.content
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        for (const line of lines.slice(-50)) {
          let entry: any;
          try { entry = JSON.parse(line); } catch { continue; }
          if (!entry || typeof entry !== "object") continue;
          const result = String(entry.result || entry.status || entry.state || "").toLowerCase();
          let status: SkillNexusItem["status"] = "ok";
          if (result.includes("fail") || result.includes("error")) { status = "error"; problemCount += 1; }
          else if (result.includes("pending") || result.includes("queue")) status = "pending";
          else if (result.includes("candidate") || result.includes("draft")) status = "candidate";
          items.push({
            id: shortHash(`evolver|run|${entry.id || ""}|${entry.timestamp || ""}`),
            name: clampText(String(entry.skill || entry.target || entry.name || "evolution-run"), 80),
            description: clampText(String(entry.summary || entry.reason || result), 200),
            mtime: Number(entry.timestamp || read.mtime) || read.mtime,
            status,
            tags: ["evolver-run", result || "run"],
            meta: {
              ...(typeof entry.scoreDelta === "number" ? { scoreDelta: Number(entry.scoreDelta.toFixed(3)) } : {}),
              ...(typeof entry.duration === "number" ? { durationMs: entry.duration } : {}),
            },
          });
        }
      }
    }

    if (lastEvolutionActivity && isStale(lastEvolutionActivity, 14)) {
      warnings.push("No evolver activity in 2+ weeks.");
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
      meta: { lastEvolutionActivity },
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
