import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

// === Council identity config =========================================
// Real agent names, linux usernames, and WSL paths live in
// council.config.local.json (gitignored). The tracked council.config.example.json
// only carries generic placeholders. This loader prefers local → example → env
// → built-in defaults, so the public repo is identity-free but a developer's
// machine can drop in their own names without changing code.

export type AgentMode = "operator" | "live" | "viewer" | "bridge";

export type AgentProfile = {
  role: string;
  mode: AgentMode;
};

export type BridgeTarget = {
  agent: string;
  launcher: string | null;
  fallbackScript: string;
};

export type SkillNexusDomainConfig = {
  id: string;
  label: string;
  type: string;
  enabled?: boolean;
  // Adapter-specific source config: path/file/endpoint/command/etc. Kept loosely-typed because
  // each adapter validates its own shape; the registry never reads it directly.
  source?: Record<string, any>;
  // Controls what makes it to the API response. label-and-relative is the default — surface
  // labels + relative paths, never absolute machine paths. label-only hides all path data.
  // redacted hides bodies/excerpts entirely (just counts).
  privacyMode?: "label-and-relative" | "label-only" | "redacted";
};

export type SkillNexusConfig = {
  enabled: boolean;
  pollIntervalMs: number;
  maxFileBytes: number;
  allowedExtensions: string[];
  ignoredGlobs: string[];
  domains: SkillNexusDomainConfig[];
};

export type CouncilConfig = {
  wsl: {
    distro: string;
    user: string;
    workspaceDir: string;
    hubScript: string;
  };
  hub: {
    url: string;
  };
  council: {
    defaultSender: string;
    defaultDmTarget: string;
    agents: Record<string, AgentProfile>;
    bridges: BridgeTarget[];
  };
  journal: {
    inboxPath: string;
    rolloverPath: string;
  };
  smartFallback: {
    enginePath: string;
    healthFile: string;
    agents: string[];
    defaultAgent: string;
  };
  skillNexus: SkillNexusConfig;
};

const CONFIG_BASE_DIR = process.cwd();
const LOCAL_PATH = process.env.COUNCIL_CONFIG_LOCAL
  || join(CONFIG_BASE_DIR, "council.config.local.json");
const EXAMPLE_PATH = process.env.COUNCIL_CONFIG_EXAMPLE
  || join(CONFIG_BASE_DIR, "council.config.example.json");

function safeReadJson(path: string): any | null {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function deepMerge<T>(target: T, source: any): T {
  if (!source || typeof source !== "object" || Array.isArray(source)) return source ?? target;
  if (!target || typeof target !== "object") return source as T;
  const out: any = Array.isArray(target) ? [...(target as any)] : { ...(target as any) };
  for (const key of Object.keys(source)) {
    if (key.startsWith("//")) continue;
    const sourceValue = (source as any)[key];
    const targetValue = (out as any)[key];
    if (sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue) && targetValue && typeof targetValue === "object" && !Array.isArray(targetValue)) {
      out[key] = deepMerge(targetValue, sourceValue);
    } else {
      out[key] = sourceValue;
    }
  }
  return out as T;
}

// Built-in fallback config — identity-free, used when no config file is available at all.
// Matches the shape of council.config.example.json.
const BUILT_IN_DEFAULTS: CouncilConfig = {
  wsl: {
    distro: "Ubuntu",
    user: "linux-user",
    workspaceDir: "/home/linux-user/.openclaw/workspace",
    hubScript: "/home/linux-user/.npm-global/lib/node_modules/xihe-jianmu-ipc/hub.mjs",
  },
  hub: { url: "http://10.255.255.254:3179" },
  council: {
    defaultSender: "operator",
    defaultDmTarget: "live-agent-1-bridge",
    agents: {
      "operator":     { role: "Operator",      mode: "operator" },
      "live-agent-1": { role: "Council Live",  mode: "live" },
      "live-agent-2": { role: "Council Live",  mode: "live" },
      "viewer-agent": { role: "Viewer Bridge", mode: "viewer" },
    },
    bridges: [
      { agent: "live-agent-1", launcher: "council-live-agent-1", fallbackScript: "live-agent-1-bridge.py" },
      { agent: "live-agent-2", launcher: "council-live-agent-2", fallbackScript: "live-agent-2-bridge.py" },
    ],
  },
  journal: {
    inboxPath: "\\\\wsl.localhost\\Ubuntu\\home\\linux-user\\.openclaw\\workspace\\logs\\council-journal.jsonl",
    rolloverPath: "\\\\wsl.localhost\\Ubuntu\\home\\linux-user\\.openclaw\\workspace\\logs\\council-journal.jsonl.1",
  },
  smartFallback: {
    enginePath: "/home/linux-user/.openclaw/workspace/smart-fallback-v5/engine.py",
    healthFile: "\\\\wsl.localhost\\Ubuntu\\home\\linux-user\\.openclaw\\workspace\\data\\smart-fallback-v5\\model-health.json",
    agents: ["live-agent-1", "live-agent-2"],
    defaultAgent: "live-agent-1",
  },
  skillNexus: {
    enabled: true,
    pollIntervalMs: 20000,
    maxFileBytes: 524288,
    allowedExtensions: [".md", ".json", ".yaml", ".yml", ".txt"],
    ignoredGlobs: ["node_modules/**", ".git/**", "__pycache__/**", "*.pyc", ".venv/**", "venv/**"],
    domains: [],
  },
};

let cached: CouncilConfig | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000;

export function loadCouncilConfig(force = false): CouncilConfig {
  const now = Date.now();
  if (!force && cached && now - cachedAt < CACHE_TTL_MS) return cached;

  // Layer order: built-in defaults → example → local. Env vars take precedence over all of them
  // at the field-by-field level below.
  let cfg = BUILT_IN_DEFAULTS;
  const exampleData = safeReadJson(EXAMPLE_PATH);
  if (exampleData) cfg = deepMerge(cfg, exampleData);
  const localData = safeReadJson(LOCAL_PATH);
  if (localData) cfg = deepMerge(cfg, localData);

  // Per-field env overrides for things developers commonly tweak without editing JSON.
  cfg = {
    ...cfg,
    wsl: {
      ...cfg.wsl,
      distro: process.env.COUNCIL_WSL_DISTRO || cfg.wsl.distro,
      user: process.env.COUNCIL_WSL_USER || cfg.wsl.user,
      workspaceDir: process.env.COUNCIL_WSL_WORKSPACE || cfg.wsl.workspaceDir,
      hubScript: process.env.COUNCIL_WSL_HUB_SCRIPT || cfg.wsl.hubScript,
    },
    hub: { url: process.env.COUNCIL_HUB_URL || cfg.hub.url },
    journal: {
      inboxPath: process.env.COUNCIL_INBOX_JSONL || cfg.journal.inboxPath,
      rolloverPath: process.env.COUNCIL_INBOX_JSONL_PREV || cfg.journal.rolloverPath,
    },
    smartFallback: {
      ...cfg.smartFallback,
      enginePath: process.env.COUNCIL_FALLBACK_ENGINE || cfg.smartFallback.enginePath,
      healthFile: process.env.COUNCIL_FALLBACK_HEALTH || cfg.smartFallback.healthFile,
      defaultAgent: process.env.COUNCIL_FALLBACK_AGENT || cfg.smartFallback.defaultAgent,
      agents: process.env.COUNCIL_FALLBACK_AGENTS
        ? process.env.COUNCIL_FALLBACK_AGENTS.split(",").map((value) => value.trim()).filter(Boolean)
        : cfg.smartFallback.agents,
    },
  };

  cached = cfg;
  cachedAt = now;
  return cfg;
}

export function invalidateCouncilConfig(): void {
  cached = null;
  cachedAt = 0;
}

// Convenience reader used by client-facing routes that should never expose paths/tokens.
// Returns only the agent identity shape — no filesystem paths, no usernames.
export type PublicCouncilIdentity = {
  defaultSender: string;
  defaultDmTarget: string;
  agents: Record<string, AgentProfile>;
};

export function publicCouncilIdentity(config = loadCouncilConfig()): PublicCouncilIdentity {
  return {
    defaultSender: config.council.defaultSender,
    defaultDmTarget: config.council.defaultDmTarget,
    agents: config.council.agents,
  };
}
