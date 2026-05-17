import "server-only";

// Duplicate-detection tracker for skill-root and any other adapter that needs to
// flag same-titled artifacts across folders. Records by (vendor?, name, folder),
// so two formats in the same folder don't self-dupe and two vendors shipping a
// same-named skill aren't flagged unless they're *truly* identical (same vendor).
//
// Usage:
//   const tracker = createDedupTracker();
//   const { count, isVariant } = tracker.record({ name, vendor, folder });
//   if (count > 1) flag as duplicate;
//
// `isVariant: true` means this item was excluded from accounting (e.g. it's an
// `-evolved` clone). Callers may still want to display it; they just shouldn't
// flag it as a problem.

export type DedupKey = {
  // The display title we'd surface to the user — typically the frontmatter `name:`
  // or the folder name.
  name: string;
  // Optional vendor namespace (e.g. "liang", "openclaw", "arc"). When set on both
  // sides of a comparison, dedup only fires if vendors match.
  vendor?: string;
  // The skill folder (relative to its root). Two files inside the same folder
  // don't dupe each other; only cross-folder collisions trip the counter.
  folder: string;
  // Skip this record from dupe accounting entirely (e.g. evolved variants).
  variant?: boolean;
};

export type DedupTracker = {
  record(key: DedupKey): { count: number; isVariant: boolean };
  // Read-only view of how many folders advertise a given title — used by tests
  // and by the snapshot's domain-level meta.
  size(): number;
};

function buildKey(key: DedupKey): string {
  const vendor = (key.vendor || "").trim().toLowerCase();
  const name = key.name.trim().toLowerCase();
  return vendor ? `${vendor}|${name}` : name;
}

export function createDedupTracker(): DedupTracker {
  const seen = new Map<string, Set<string>>();

  return {
    record(key) {
      if (key.variant || !key.name || !key.folder) {
        return { count: 0, isVariant: !!key.variant };
      }
      const k = buildKey(key);
      const folders = seen.get(k) || new Set<string>();
      folders.add(key.folder);
      seen.set(k, folders);
      return { count: folders.size, isVariant: false };
    },
    size() {
      return seen.size;
    },
  };
}
