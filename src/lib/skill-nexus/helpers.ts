import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, relative, sep } from "node:path";

import { loadCouncilConfig } from "@/lib/council-config";

export function shortHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

// Path is private. Always convert to a relative path against the configured root before
// returning anything to the client. Falls back to basename if it isn't under root.
export function toRelativePath(absPath: string, rootPath: string): string {
  try {
    const rel = relative(rootPath, absPath);
    if (rel && !rel.startsWith("..")) return rel.split(sep).join("/");
  } catch {
    /* fall through */
  }
  return basename(absPath);
}

// Mtime check — "stale" if older than the threshold in days.
export function isStale(mtimeMs: number, staleDays = 60): boolean {
  if (!mtimeMs || !Number.isFinite(mtimeMs)) return false;
  return Date.now() - mtimeMs > staleDays * 86_400_000;
}

// Read file safely with a size cap. Returns null on oversized / missing / unreadable.
export async function safeReadText(
  path: string,
  maxBytes: number
): Promise<{ content: string; size: number; mtime: number } | { oversized: true; size: number; mtime: number } | null> {
  try {
    const stat = await fs.stat(path);
    if (stat.size > maxBytes) {
      return { oversized: true, size: stat.size, mtime: stat.mtimeMs };
    }
    const content = await fs.readFile(path, "utf8");
    return { content, size: stat.size, mtime: stat.mtimeMs };
  } catch {
    return null;
  }
}

// Redact configured agent names + common operator handles from a free-text string. SKILL.md
// descriptions and evolver reasoning fields routinely cite real agent names (e.g. "Drift uses
// this when…", "Iris triggers", "Eve's daily check"); leaving them through would leak the
// same identifiers the rest of the HUD scrubs. Lowercase variants are NOT redacted because
// many agent names overlap with common shell/code words (echo, prime, novelty) — only the
// capitalized standalone form is replaced.
//
// Replacement strategy: each configured agent gets a generic placeholder based on its mode
// (operator → "the operator", live → "a live agent", viewer → "a viewer agent", bridge → "a bridge").
export function redactAgentNames(text: string): string {
  if (!text) return text;
  let out = text;
  try {
    const agents = loadCouncilConfig().council.agents;
    for (const [name, profile] of Object.entries(agents)) {
      if (!name || name.length < 2) continue;
      const capitalized = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
      const replacement = profile.mode === "operator"
        ? "the operator"
        : profile.mode === "viewer"
          ? "a viewer agent"
          : profile.mode === "bridge"
            ? "a bridge"
            : "a live agent";
      // Word-boundaried, case-sensitive on the capitalized form. Avoids gutting innocent
      // lowercase words ("echo the value", "prime number", "iris flower").
      out = out.replace(new RegExp(`\\b${capitalized}\\b`, "g"), replacement);
      // Also catch UPPERCASE shouting form.
      out = out.replace(new RegExp(`\\b${name.toUpperCase()}\\b`, "g"), replacement.toUpperCase());
    }
    // Common operator-identifier patterns that aren't in agents map.
    out = out.replace(/\bAlvin\b/g, "the operator");
  } catch {
    // If config load fails for any reason, return original — better than crashing the scan.
  }
  return out;
}

// Cap an arbitrary string to a max display length without breaking mid-word.
export function clampText(value: string, maxLen = 200): string {
  if (!value) return "";
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut) + "…";
}

// Strip markdown decorations + leading frontmatter for the description preview.
// Returns title + description + auxiliary frontmatter fields (homepage, version, license,
// requires) that are safe to surface. Agent identifiers are redacted from free-text fields.
export function stripMarkdownPreview(content: string): {
  title: string;
  description: string;
  homepage?: string;
  version?: string;
  license?: string;
  requires?: string[];
  headingCount?: number;
  codeBlockCount?: number;
  bulletCount?: number;
} {
  if (!content) return { title: "", description: "" };

  let body = content;
  let frontmatterTitle = "";
  let frontmatterDescription = "";
  let homepage = "";
  let version = "";
  let license = "";
  const requires: string[] = [];

  // YAML frontmatter (--- … ---).
  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (fmMatch) {
    const yamlBlock = fmMatch[1];
    body = fmMatch[2];
    for (const line of yamlBlock.split(/\r?\n/)) {
      const fieldMatch = line.match(/^(name|title|description|summary|homepage|version|license)\s*:\s*(.+)$/i);
      if (!fieldMatch) continue;
      const key = fieldMatch[1].toLowerCase();
      const value = fieldMatch[2].trim().replace(/^["']|["']$/g, "");
      if ((key === "name" || key === "title") && !frontmatterTitle) frontmatterTitle = value;
      if ((key === "description" || key === "summary") && !frontmatterDescription) frontmatterDescription = value;
      if (key === "homepage") homepage = value;
      if (key === "version") version = value;
      if (key === "license") license = value;
    }
    // Best-effort capture of requires.env: [LIST] across multi-line YAML.
    const envMatch = yamlBlock.match(/requires[\s\S]*?env\s*:\s*\[([^\]]*)\]/i);
    if (envMatch) {
      for (const item of envMatch[1].split(",")) {
        const cleaned = item.trim().replace(/^["']|["']$/g, "");
        if (cleaned && /^[A-Z_][A-Z0-9_]*$/i.test(cleaned)) requires.push(cleaned);
      }
    }
  }

  const lines = body.split(/\r?\n/);
  let title = frontmatterTitle;
  let description = frontmatterDescription;

  if (!title) {
    const headingLine = lines.find((line) => /^#{1,3}\s+\S/.test(line));
    if (headingLine) title = headingLine.replace(/^#{1,3}\s+/, "").trim();
  }
  if (!description) {
    const firstPara = lines.find((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith("#")) return false;
      if (trimmed.startsWith("```")) return false;
      if (trimmed.startsWith("---")) return false;
      return true;
    });
    description = firstPara ? firstPara.replace(/^[*_>`-]+\s*/, "") : "";
  }

  // Quick structural counts — useful for IMC-style "examples present?" / "steps present?" hints.
  const headingCount = lines.filter((line) => /^#{1,6}\s+\S/.test(line)).length;
  const codeBlockCount = (body.match(/```[a-z]*\b/gi) || []).length;
  const bulletCount = lines.filter((line) => /^\s*(?:[-*+]|\d+\.)\s+\S/.test(line)).length;

  return {
    title: clampText(redactAgentNames(title), 80),
    description: clampText(redactAgentNames(description), 200),
    ...(homepage ? { homepage: clampText(homepage, 120) } : {}),
    ...(version ? { version: clampText(version, 40) } : {}),
    ...(license ? { license: clampText(license, 40) } : {}),
    ...(requires.length > 0 ? { requires } : {}),
    headingCount,
    codeBlockCount,
    bulletCount,
  };
}

// Walk a directory non-recursively but follow one level of nested skill folders. Returns
// candidate skill files for the skillRoot adapter. Honors allowed extensions + ignored globs.
export async function walkSkillRoot(
  rootPath: string,
  options: { allowedExtensions: string[]; maxDepth?: number }
): Promise<Array<{ absPath: string; type: "skill.md" | "doc" }>> {
  const allowed = new Set(options.allowedExtensions.map((ext) => ext.toLowerCase()));
  const maxDepth = options.maxDepth ?? 3;
  const result: Array<{ absPath: string; type: "skill.md" | "doc" }> = [];

  async function visit(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      if (entry.name === "node_modules" || entry.name === "__pycache__" || entry.name === ".venv") continue;
      const fullPath = `${dir}${sep}${entry.name}`;
      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const lowered = entry.name.toLowerCase();
      const ext = lowered.includes(".") ? lowered.slice(lowered.lastIndexOf(".")) : "";
      if (!allowed.has(ext)) continue;
      const isSkillFile = lowered === "skill.md" || lowered === "skill.yaml" || lowered === "skill.json";
      result.push({ absPath: fullPath, type: isSkillFile ? "skill.md" : "doc" });
    }
  }

  await visit(rootPath, 0);
  return result;
}
