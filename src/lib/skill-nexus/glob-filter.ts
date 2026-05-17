import "server-only";

// Minimal glob-to-RegExp for per-domain ignoredGlobs. Supports the subset of
// patterns we actually use in council.config: `**` (recursive), `*` (segment),
// `?` (single char), and literal slashes. Patterns are matched case-insensitively
// against forward-slash-normalized relative paths.
//
// Examples:
//   "node_modules/**"               → /^node_modules\/.*$/i
//   "**/references/llms-*.md"       → /^.*\/references\/llms-[^/]*\.md$/i
//   "*.pyc"                         → /^[^/]*\.pyc$/i
//
// This intentionally does not bring in minimatch/picomatch — Skill Nexus only
// needs the half-dozen patterns above, and the dependency cost isn't worth it.

function globToRegExp(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**` matches anything including slashes. Followed by `/` we consume it
        // so `**/foo` matches `foo` at root too.
        regex += ".*";
        i += 2;
        if (pattern[i] === "/") i += 1;
      } else {
        // `*` matches everything except a path separator.
        regex += "[^/]*";
        i += 1;
      }
      continue;
    }
    if (c === "?") {
      regex += "[^/]";
      i += 1;
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(c)) {
      regex += `\\${c}`;
    } else {
      regex += c;
    }
    i += 1;
  }
  return new RegExp(`^${regex}$`, "i");
}

// Cache compiled regexes — patterns are stable across a scan.
const regexCache = new Map<string, RegExp>();
function compile(pattern: string): RegExp {
  let r = regexCache.get(pattern);
  if (!r) {
    r = globToRegExp(pattern);
    regexCache.set(pattern, r);
  }
  return r;
}

// Match a forward-slash-normalized path against any of the patterns.
export function matchesAnyGlob(path: string, patterns: readonly string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false;
  const normalized = path.split(/[\\/]/).join("/");
  for (const pattern of patterns) {
    if (compile(pattern).test(normalized)) return true;
  }
  return false;
}

// Build a single matcher closure for a fixed pattern list — useful inside a
// scan loop where the same patterns get tested against many paths.
export function buildGlobMatcher(patterns: readonly string[] | undefined): (path: string) => boolean {
  if (!patterns || patterns.length === 0) return () => false;
  const compiled = patterns.map(compile);
  return (path: string) => {
    const normalized = path.split(/[\\/]/).join("/");
    for (const regex of compiled) {
      if (regex.test(normalized)) return true;
    }
    return false;
  };
}
