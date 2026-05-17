import "server-only";

// Per-skill-folder files that exist by design once per folder. Surfacing them as
// items in the Skill Nexus feed adds 250+ noise rows to a 250-skill bundle and
// trips false duplicate flags. They're filtered out of the item feed entirely;
// adapters can still record a `suppressedStructural` counter for transparency.
//
// Add to this set sparingly — anything listed here will become invisible to
// the HUD's Issues feed even when it's malformed. Use ignoredGlobs (per-domain)
// for path-shaped exclusions instead.
export const STRUCTURAL_FILES: ReadonlySet<string> = new Set([
  "_meta.json",
  "evolution_meta.json",
  "package.json",
  "openai.yaml",
  "license.txt",
  "notice.txt",
  "description.md",
  "readme.md",
  "index.js",
  "__init__.py",
  "tsconfig.json",
]);

export function isStructuralFile(filename: string): boolean {
  return STRUCTURAL_FILES.has(filename.toLowerCase());
}
