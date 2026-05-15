import "server-only";

import { loadCouncilConfig } from "@/lib/council-config";
import type { SkillNexusReport, SkillNexusDomainSnapshot } from "./types";
import { adapterErrorSnapshot, disabledDomainSnapshot, resolveAdapter, unsupportedAdapterSnapshot } from "./registry";

// Run every configured domain in parallel, swallow per-adapter exceptions so one failure
// doesn't break the whole report. Caller always gets a fully-shaped report.
export async function scanSkillNexus(): Promise<SkillNexusReport> {
  const cfg = loadCouncilConfig();
  const generatedAt = Date.now();
  const skillNexus = cfg.skillNexus;

  if (!skillNexus.enabled) {
    return {
      ok: true,
      enabled: false,
      generatedAt,
      pollIntervalMs: skillNexus.pollIntervalMs,
      totals: { domains: 0, enabledDomains: 0, healthyDomains: 0, items: 0, problems: 0, warnings: 0 },
      domains: [],
      unsupportedDomains: [],
    };
  }

  const unsupportedDomains: SkillNexusReport["unsupportedDomains"] = [];
  const snapshotPromises: Promise<SkillNexusDomainSnapshot>[] = skillNexus.domains.map(async (domain) => {
    if (domain.enabled === false) return disabledDomainSnapshot(domain);
    const adapter = resolveAdapter(domain.type);
    if (!adapter) {
      unsupportedDomains.push({ id: domain.id, label: domain.label, type: domain.type });
      return unsupportedAdapterSnapshot(domain);
    }
    try {
      return await adapter.scan(domain);
    } catch (error: any) {
      return adapterErrorSnapshot(domain, error?.message || "unknown adapter failure");
    }
  });

  const domains = await Promise.all(snapshotPromises);

  const totals = {
    domains: domains.length,
    enabledDomains: domains.filter((domain) => domain.enabled).length,
    healthyDomains: domains.filter((domain) => domain.health === "ok").length,
    items: domains.reduce((sum, domain) => sum + domain.itemCount, 0),
    problems: domains.reduce((sum, domain) => sum + domain.problemCount, 0),
    warnings: domains.reduce((sum, domain) => sum + domain.warnings.length, 0),
  };

  return {
    ok: true,
    enabled: true,
    generatedAt,
    pollIntervalMs: skillNexus.pollIntervalMs,
    totals,
    domains,
    unsupportedDomains,
  };
}
