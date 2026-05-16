import "server-only";

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { clampText, isStale, redactAgentNames, safeReadText, shortHash, stripMarkdownPreview, toRelativePath } from "../helpers";

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
//   - maxFileBytes: per-domain byte cap that overrides skillNexus.maxFileBytes for the
//                   bulky state/applied/log files. Use when state.json grows past 512KB
//                   (heavily-iterated evolvers do — that's expected, not a failure).
export const skillEvolverAdapter: SkillNexusAdapter = {
  type: "skillEvolver",
  async scan(domain: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot> {
    const cfg = loadCouncilConfig();
    const skillsDir = String(domain.source?.skillsDir || domain.source?.path || "").trim();
    const evolvedSuffix = String(domain.source?.evolvedSuffix || "-evolved");
    const statePath = String(domain.source?.statePath || "").trim();
    const appliedPath = String(domain.source?.appliedPath || "").trim();
    const logPath = String(domain.source?.logPath || "").trim();
    // Per-domain byte cap with a sensible 4 MB floor for the state files specifically
    // (parent skill walks still use the global cap to stay tight). state.json grows
    // unboundedly on heavily-iterated evolvers, and silently skipping it loses the
    // best-score / pending-runs signal entirely.
    const stateMaxBytes = Math.max(
      Number(domain.source?.maxFileBytes || 0) || 0,
      cfg.skillNexus.maxFileBytes,
      4 * 1024 * 1024,
    );
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

        // evolution_meta.json is the Evolver's IMC-shaped output. Extract:
        //   - final_score / original_score   → overall compliance
        //   - best_genome.{actionability,clarity,specificity,example_count,step_count,novelty}
        //     → the IMC-axis breakdown (actionability / clarity / specificity / examples / steps
        //       map directly onto IMC rules; novelty is evolver-specific)
        //   - last evolution_history[].judgment → promote / revise / reject
        let scoreDelta: number | null = null;
        let evolutionTimestamp: number | null = null;
        let genomeId: string = "";
        let finalScore: number | null = null;
        let originalScore: number | null = null;
        let judgment: string = "";
        let promoted: boolean | null = null;
        let failureReason: string = "";
        let generationsRun: number | null = null;
        let attemptsLogged: number | null = null;
        let lastMethod: string = "";
        const imcDims: Record<string, number> = {};
        let evolverReason = "";
        let judgmentHistogram: Record<string, number> = {};

        const metaRead = await safeReadText(metaPath, cfg.skillNexus.maxFileBytes);
        if (metaRead && !("oversized" in metaRead)) {
          try {
            const parsed = JSON.parse(metaRead.content);
            scoreDelta = Number(parsed?.scoreDelta ?? parsed?.score_delta ?? parsed?.improvement ?? NaN);
            // evolved_at is the canonical evolver-emitted timestamp (preferred over mtime).
            evolutionTimestamp = Number(parsed?.evolved_at ?? parsed?.timestamp ?? parsed?.applied_at ?? NaN);
            genomeId = String(parsed?.genome ?? parsed?.genomeId ?? parsed?.id ?? "");
            finalScore = Number(parsed?.final_score ?? parsed?.finalScore ?? NaN);
            originalScore = Number(parsed?.original_score ?? parsed?.originalScore ?? NaN);
            if (!Number.isFinite(scoreDelta as number) && Number.isFinite(finalScore as number) && Number.isFinite(originalScore as number)) {
              scoreDelta = (finalScore as number) - (originalScore as number);
            }
            // Was this evolution actually promoted/applied? Separate from per-generation judgment.
            promoted = typeof parsed?.promoted === "boolean" ? parsed.promoted : null;
            failureReason = String(parsed?.failure_reason ?? parsed?.failureReason ?? "").trim();
            generationsRun = Number(parsed?.generations_run ?? parsed?.generationsRun ?? NaN);
            if (!Number.isFinite(generationsRun as number)) generationsRun = null;

            // Genome dimensions: best_genome fields are 0..1, evolution_history's per-axis fields
            // are 0..100. Normalise into integer percentages for display.
            const bestGenome = parsed?.best_genome || parsed?.bestGenome || {};
            for (const key of ["actionability", "clarity", "specificity", "novelty"]) {
              const raw = Number(bestGenome?.[key]);
              if (Number.isFinite(raw)) imcDims[key] = Math.round(raw <= 1 ? raw * 100 : raw);
            }
            if (Number.isFinite(Number(bestGenome?.example_count))) imcDims.examples = Math.round(Number(bestGenome.example_count));
            if (Number.isFinite(Number(bestGenome?.step_count))) imcDims.steps = Math.round(Number(bestGenome.step_count));

            const history = Array.isArray(parsed?.evolution_history) ? parsed.evolution_history : [];
            attemptsLogged = history.length;
            // Count every per-generation judgment, surface it so the UI can show "5 attempts → 3 promote / 2 revise".
            for (const entry of history) {
              if (!entry || typeof entry !== "object") continue;
              const j = String(entry.judgment || entry.verdict || "").toLowerCase();
              if (j) judgmentHistogram[j] = (judgmentHistogram[j] || 0) + 1;
            }
            const lastHist = history.length > 0 ? history[history.length - 1] : null;
            if (lastHist && typeof lastHist === "object") {
              judgment = String(lastHist.judgment || lastHist.verdict || "").toLowerCase();
              evolverReason = String(lastHist.reasoning || lastHist.summary || "");
              lastMethod = String(lastHist.method || "").toLowerCase();
            }
          } catch {
            warnings.push(`evolution_meta.json parse error in ${evolvedName}.`);
          }
        }

        // IMC compliance level derived from final_score (per IMC.md scoring bands):
        //   ≥90 full · ≥70 good · ≥50 partial · <50 poor
        const imcLevel = !Number.isFinite(finalScore as number) ? ""
          : (finalScore as number) >= 90 ? "full"
          : (finalScore as number) >= 70 ? "good"
          : (finalScore as number) >= 50 ? "partial"
          : "poor";

        const stale = stat && isStale(stat.mtimeMs, 60);
        let status: SkillNexusItem["status"] = "ok";
        if (!hasSkillMd) { status = "error"; problemCount += 1; }
        else if (!parentExists) { status = "missing"; problemCount += 1; }
        else if (judgment === "reject" || judgment === "fail" || judgment === "failed") { status = "error"; problemCount += 1; }
        else if (judgment === "revise") { status = "pending"; }
        else if (judgment === "candidate" || judgment === "draft") { status = "candidate"; }
        else if (imcLevel === "poor" || imcLevel === "partial") { status = "stale"; problemCount += 1; }
        else if (stale) { status = "stale"; problemCount += 1; }
        else if (judgment === "promote") { status = "ok"; }

        const tags = ["evolved", parentExists ? "paired" : "orphan"];
        if (judgment) tags.push(judgment);
        if (imcLevel) tags.push(`imc:${imcLevel}`);

        // Build a compact attempts-summary string like "3 attempts (promote 1, revise 2)" for the UI.
        const histSummary = Object.keys(judgmentHistogram).length > 0
          ? Object.entries(judgmentHistogram).map(([j, n]) => `${j} ${n}`).join(" / ")
          : "";

        items.push({
          id: shortHash(`evolver|${evolvedName}|${genomeId}`),
          name: clampText(redactAgentNames(title || parentName), 80),
          description: clampText(
            redactAgentNames(evolverReason || description || (parentExists ? `Evolved from ${parentName}` : "Evolved skill (parent missing)")),
            200
          ),
          relativePath: toRelativePath(evolvedPath, skillsDir),
          mtime: evolutionTimestamp || stat?.mtimeMs || 0,
          status,
          tags,
          meta: {
            parent: parentName,
            parentPresent: parentExists,
            ...(Number.isFinite(finalScore as number) ? { imcScore: Math.round(finalScore as number) } : {}),
            ...(Number.isFinite(originalScore as number) ? { originalScore: Math.round(originalScore as number) } : {}),
            ...(imcLevel ? { imc: imcLevel } : {}),
            ...(judgment ? { judgment } : {}),
            ...(promoted !== null ? { promoted } : {}),
            ...(failureReason && failureReason !== "unknown" ? { failureReason: clampText(failureReason, 80) } : {}),
            ...(Number.isFinite(generationsRun as number) && (generationsRun as number) > 0 ? { generations: generationsRun as number } : {}),
            ...(attemptsLogged && attemptsLogged > 0 ? { attempts: attemptsLogged } : {}),
            ...(histSummary ? { historySummary: histSummary } : {}),
            ...(lastMethod ? { method: lastMethod } : {}),
            ...(Number.isFinite(scoreDelta as number) ? { scoreDelta: Number((scoreDelta as number).toFixed(2)) } : {}),
            ...imcDims,
            ...(genomeId ? { genome: genomeId.slice(0, 12) } : {}),
            hasSkillMd,
          },
        });
      }
    }

    // --- Optional state.json: surfaces current best-score / pending evolutions ---
    if (statePath) {
      const read = await safeReadText(statePath, stateMaxBytes);
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
      const read = await safeReadText(appliedPath, stateMaxBytes);
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
      const read = await safeReadText(logPath, stateMaxBytes);
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
