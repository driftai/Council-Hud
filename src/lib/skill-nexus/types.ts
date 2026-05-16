import "server-only";
import type { SkillNexusDomainConfig } from "@/lib/council-config";

export type SkillItemStatus =
  | "ok"
  | "stale"
  | "duplicate"
  | "conflicted"
  | "missing"
  | "oversized"
  | "error"
  | "pending"
  | "candidate"
  | "deprecated"
  | "rejected"; // Expected outcome (e.g. evolution trial with kept=false / improvement<0).
                // Treated as non-problem in the IssuesPanel since rejection is by design.

export type SkillNexusItem = {
  // Stable per-snapshot id (hash of name + relativePath + source).
  id: string;
  // Display name. Could be SKILL.md frontmatter title, filename without extension, or
  // adapter-defined label (Skill Forge candidate name, Session Miner suggestion name, etc.).
  name: string;
  // Short freeform description. Adapters cap to ~200 chars after stripping markdown/HTML.
  description?: string;
  // Path relative to the domain source root. Never absolute. Empty/undefined when the item
  // has no on-disk representation (e.g. a Session Miner candidate that's in-memory).
  relativePath?: string;
  // Bytes on disk if applicable.
  size?: number;
  // Unix millis of last on-disk modification.
  mtime?: number;
  // 12-char content hash for change detection. Adapters compute over the safe text body.
  hash?: string;
  // Per-item health/status. Drives the row color in the UI.
  status?: SkillItemStatus;
  // Adapter-defined tag list. Adapters MUST NOT use tags to leak identity (no agent names,
  // no usernames). Example tags: "frontmatter", "skill.md", "candidate", "validated".
  tags?: string[];
  // Adapter-specific small metadata. Numbers/strings only. No nested objects with private
  // content. The UI may render these as small badge values.
  meta?: Record<string, string | number | boolean>;
};

export type SkillNexusDomainHealth =
  | "ok"
  | "degraded"
  | "unreachable"
  | "disabled"
  | "unsupported"
  | "empty";

export type SkillNexusDomainSnapshot = {
  // Mirrors the config entry so the UI can render without re-reading config.
  id: string;
  label: string;
  type: string;
  enabled: boolean;
  // Aggregate domain status.
  health: SkillNexusDomainHealth;
  // Total items reported by this adapter.
  itemCount: number;
  // Items in non-ok state (sum of stale/duplicate/conflicted/missing/oversized/error/etc).
  problemCount: number;
  // Adapter-emitted warnings — strings safe to surface. No paths/tokens/agent names.
  warnings: string[];
  // The actual item list. UI typically shows the first N and offers a "see all" expander.
  items: SkillNexusItem[];
  // Wall-clock when scan completed.
  generatedAt: number;
  // Adapter-specific summary (last-update epoch, counts by sub-type, etc).
  meta?: Record<string, string | number | boolean>;
};

export interface SkillNexusAdapter {
  readonly type: string;
  scan(config: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot>;
}

// Aggregate response returned by /api/council/skill-nexus.
export type SkillNexusReport = {
  ok: boolean;
  enabled: boolean;
  generatedAt: number;
  pollIntervalMs: number;
  // Cross-domain rollup for the Overview tab.
  totals: {
    domains: number;
    enabledDomains: number;
    healthyDomains: number;
    items: number;
    problems: number;
    warnings: number;
  };
  domains: SkillNexusDomainSnapshot[];
  // Adapters that couldn't be resolved (config referenced an unknown type). Surfaced so the
  // UI can show "unavailable adapter" rather than crashing.
  unsupportedDomains: Array<{ id: string; label: string; type: string }>;
};
