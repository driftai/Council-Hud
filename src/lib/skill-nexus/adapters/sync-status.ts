import "server-only";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { clampText, isStale, redactAgentNames, safeReadText, shortHash } from "../helpers";

// Sync Status adapter: reads a snapshot JSON describing cross-agent skill sync. Expected shape
// is loose — { agents: { <agent>: { lastSync, skills, missing, conflicts } } } — but any object
// with comparable fields is summarized. Real agent names are surfaced as opaque labels coming
// from the file itself; this adapter does not assume any particular agent identity.
export const syncStatusAdapter: SkillNexusAdapter = {
  type: "syncStatus",
  async scan(domain: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot> {
    const cfg = loadCouncilConfig();
    const path = String(domain.source?.path || "").trim();
    const now = Date.now();
    if (!path) return base(domain, "unreachable", ["Source path is empty."]);
    const read = await safeReadText(path, cfg.skillNexus.maxFileBytes);
    if (!read) return base(domain, "unreachable", ["Sync status file not reachable."]);
    if ("oversized" in read) return base(domain, "degraded", ["Sync status file oversized."]);

    let parsed: any;
    try { parsed = JSON.parse(read.content); }
    catch (parseError: any) { return base(domain, "degraded", [`Parse error: ${parseError?.message}`]); }

    const agents = parsed?.agents && typeof parsed.agents === "object" ? parsed.agents : parsed;
    const items: SkillNexusItem[] = [];
    let problemCount = 0;
    const warnings: string[] = [];

    if (!agents || typeof agents !== "object") {
      return base(domain, "degraded", ["Sync status JSON missing 'agents' field."]);
    }

    for (const [key, value] of Object.entries(agents)) {
      if (!value || typeof value !== "object") continue;
      const info = value as any;
      const lastSync = Number(info.lastSync || info.lastUpdated || info.timestamp || 0);
      const stale = lastSync && isStale(lastSync, 7);
      const missing = Number(info.missing || info.missingCount || 0);
      const conflicts = Number(info.conflicts || info.conflictCount || 0);
      const status: SkillNexusItem["status"] =
        conflicts > 0 ? "conflicted"
          : missing > 0 ? "missing"
          : stale ? "stale"
          : "ok";
      if (status !== "ok") problemCount += 1;
      items.push({
        id: shortHash(`sync|${key}|${lastSync}`),
        name: clampText(redactAgentNames(key), 80),
        description: clampText(redactAgentNames(String(info.summary || info.note || "")), 200),
        mtime: lastSync || read.mtime,
        status,
        tags: ["sync"],
        meta: {
          ...(missing > 0 ? { missing } : {}),
          ...(conflicts > 0 ? { conflicts } : {}),
          ...(typeof info.skills === "number" ? { skills: info.skills } : {}),
        },
      });
    }

    if (items.length === 0) warnings.push("Sync status file present but had no agent records.");

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
