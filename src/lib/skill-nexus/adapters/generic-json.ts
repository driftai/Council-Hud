import "server-only";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot, SkillNexusItem } from "../types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";
import { loadCouncilConfig } from "@/lib/council-config";
import { clampText, redactAgentNames, safeReadText, shortHash } from "../helpers";

// Generic JSON adapter: a catch-all for any JSON snapshot file someone wants to monitor. It
// surfaces top-level entries (keys of an object, or items of an array) as Skill Nexus items
// using whatever name/title/description fields are present.
export const genericJsonAdapter: SkillNexusAdapter = {
  type: "genericJson",
  async scan(domain: SkillNexusDomainConfig): Promise<SkillNexusDomainSnapshot> {
    const cfg = loadCouncilConfig();
    const path = String(domain.source?.path || "").trim();
    const now = Date.now();
    if (!path) return base(domain, "unreachable", ["Source path is empty."]);

    const read = await safeReadText(path, cfg.skillNexus.maxFileBytes);
    if (!read) return base(domain, "unreachable", ["File not reachable."]);
    if ("oversized" in read) return base(domain, "degraded", ["File oversized."]);

    let parsed: any;
    try { parsed = JSON.parse(read.content); }
    catch (parseError: any) { return base(domain, "degraded", [`Parse error: ${parseError?.message}`]); }

    const records: any[] = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed || {}).map(([key, value]) => ({ key, ...(value && typeof value === "object" ? value : { value }) }));

    const items: SkillNexusItem[] = records.slice(0, 200).map((record) => {
      const rawName = String(record.name || record.title || record.id || record.key || "entry");
      return {
        id: shortHash(`${rawName}|${JSON.stringify(record).slice(0, 80)}`),
        name: clampText(redactAgentNames(rawName), 80),
        description: clampText(redactAgentNames(String(record.description || record.summary || "")), 200),
        mtime: Number(record.timestamp || record.mtime || read.mtime) || read.mtime,
        status: "ok",
        tags: ["json"],
      };
    });

    return {
      id: domain.id,
      label: domain.label,
      type: domain.type,
      enabled: domain.enabled !== false,
      health: items.length === 0 ? "empty" : "ok",
      itemCount: items.length,
      problemCount: 0,
      warnings: records.length > 200 ? [`Truncated at 200 entries (file had ${records.length}).`] : [],
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
