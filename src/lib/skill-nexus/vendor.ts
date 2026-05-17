import "server-only";

// Vendor-namespace extraction for skill metadata. A "vendor" here is the upstream
// authoring namespace (liang, arc, openclaw, agentic, hermes, …) that lets
// dedup distinguish between "two skills with the same name from different sources"
// (legitimate variants) and "two copies of the same skill" (an actual dupe).
//
// Resolution order:
//   1. `vendor:` field in YAML frontmatter — explicit and authoritative.
//   2. Folder-name prefix heuristic — `liang-foo-skill/` → vendor=liang.
//   3. Empty string — caller falls back to non-vendored dedup.
//
// The heuristic only fires when the folder name matches a known-vendor prefix.
// Anything else returns "" and the caller treats the item as unvendored. This is
// intentional: arbitrary slug prefixes (e.g. `ai-`, `auto-`, `my-`) are not
// vendors, and we want the explicit frontmatter to be the upgrade path.

// Known authoring namespaces in this workspace. Add new vendors here as their
// folders show up. The list is also used by the migration helper to backfill
// `vendor:` frontmatter on existing skills.
export const KNOWN_VENDORS: readonly string[] = [
  "liang",
  "arc",
  "agentic",
  "openclaw",
  "hermes",
  "nexus",
  "drift",
  "ralph",
];

const VENDOR_SET = new Set(KNOWN_VENDORS);

export function inferVendorFromFolder(folder: string): string {
  if (!folder) return "";
  const base = folder.split(/[\\/]/).pop() || "";
  const dashIdx = base.indexOf("-");
  if (dashIdx <= 0) return "";
  const prefix = base.slice(0, dashIdx).toLowerCase();
  return VENDOR_SET.has(prefix) ? prefix : "";
}

// Pull a `vendor:` field from a YAML frontmatter block. Returns "" when not present.
// Tolerates quoted/unquoted values and trailing comments.
export function parseVendorFromFrontmatter(content: string): string {
  if (!content) return "";
  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return "";
  for (const line of fmMatch[1].split(/\r?\n/)) {
    const m = line.match(/^vendor\s*:\s*(.+?)\s*(?:#.*)?$/i);
    if (m) {
      return m[1].trim().replace(/^["']|["']$/g, "").toLowerCase();
    }
  }
  return "";
}

// Resolve the most authoritative vendor for a SKILL.md file.
export function resolveVendor(content: string, folder: string): string {
  const fromFrontmatter = parseVendorFromFrontmatter(content);
  if (fromFrontmatter) return fromFrontmatter;
  return inferVendorFromFolder(folder);
}
