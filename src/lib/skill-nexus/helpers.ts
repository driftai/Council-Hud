import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, relative, sep } from "node:path";

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
export function stripMarkdownPreview(content: string): { title: string; description: string } {
  if (!content) return { title: "", description: "" };

  let body = content;
  let frontmatterTitle = "";
  let frontmatterDescription = "";

  // YAML frontmatter (--- … ---).
  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (fmMatch) {
    const yamlBlock = fmMatch[1];
    body = fmMatch[2];
    for (const line of yamlBlock.split(/\r?\n/)) {
      const fieldMatch = line.match(/^(name|title|description|summary)\s*:\s*(.+)$/i);
      if (!fieldMatch) continue;
      const key = fieldMatch[1].toLowerCase();
      const value = fieldMatch[2].trim().replace(/^["']|["']$/g, "");
      if ((key === "name" || key === "title") && !frontmatterTitle) frontmatterTitle = value;
      if ((key === "description" || key === "summary") && !frontmatterDescription) frontmatterDescription = value;
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

  return { title: clampText(title, 80), description: clampText(description, 200) };
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
