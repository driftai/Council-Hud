import "server-only";

import type { SkillNexusAdapter, SkillNexusDomainSnapshot } from "./types";
import type { SkillNexusDomainConfig } from "@/lib/council-config";

import { skillRootAdapter } from "./adapters/skill-root";
import { reportFileAdapter } from "./adapters/report-file";
import { sessionMinerAdapter } from "./adapters/session-miner";
import { skillForgeAdapter } from "./adapters/skill-forge";
import { skillEvolverAdapter } from "./adapters/skill-evolver";
import { projectDocsAdapter } from "./adapters/project-docs";
import { syncStatusAdapter } from "./adapters/sync-status";
import { genericJsonAdapter } from "./adapters/generic-json";

const REGISTRY: Record<string, SkillNexusAdapter> = {
  [skillRootAdapter.type]: skillRootAdapter,
  [reportFileAdapter.type]: reportFileAdapter,
  [sessionMinerAdapter.type]: sessionMinerAdapter,
  [skillForgeAdapter.type]: skillForgeAdapter,
  [skillEvolverAdapter.type]: skillEvolverAdapter,
  [projectDocsAdapter.type]: projectDocsAdapter,
  [syncStatusAdapter.type]: syncStatusAdapter,
  [genericJsonAdapter.type]: genericJsonAdapter,
};

export function resolveAdapter(type: string): SkillNexusAdapter | null {
  return REGISTRY[type] || null;
}

export function listSupportedTypes(): string[] {
  return Object.keys(REGISTRY).sort();
}

// Standard "this adapter type doesn't exist" snapshot the orchestrator emits so the UI can
// render it as a row instead of crashing.
export function unsupportedAdapterSnapshot(domain: SkillNexusDomainConfig): SkillNexusDomainSnapshot {
  return {
    id: domain.id,
    label: domain.label,
    type: domain.type,
    enabled: domain.enabled !== false,
    health: "unsupported",
    itemCount: 0,
    problemCount: 0,
    warnings: [`No adapter registered for type "${domain.type}". Supported: ${listSupportedTypes().join(", ")}.`],
    items: [],
    generatedAt: Date.now(),
  };
}

export function disabledDomainSnapshot(domain: SkillNexusDomainConfig): SkillNexusDomainSnapshot {
  return {
    id: domain.id,
    label: domain.label,
    type: domain.type,
    enabled: false,
    health: "disabled",
    itemCount: 0,
    problemCount: 0,
    warnings: [],
    items: [],
    generatedAt: Date.now(),
  };
}

export function adapterErrorSnapshot(
  domain: SkillNexusDomainConfig,
  message: string
): SkillNexusDomainSnapshot {
  return {
    id: domain.id,
    label: domain.label,
    type: domain.type,
    enabled: domain.enabled !== false,
    health: "degraded",
    itemCount: 0,
    problemCount: 0,
    warnings: [`Adapter error: ${message}`],
    items: [],
    generatedAt: Date.now(),
  };
}
