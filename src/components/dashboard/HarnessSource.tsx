"use client";

import { useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { cn } from "@/lib/utils";
import { ExternalLink, Cpu, Network, Bot, Boxes, ScrollText, Wrench, Server } from "lucide-react";

// Harness Source: a launcher card that surfaces features ORIGINATING from openclaw and
// hermes (not custom HUD work). Most native features have their own web UIs — this card
// gives one-click access plus a brief description so new operators can find them.
//
// Entries deliberately don't try to mirror the source UIs' state; the HUD's other cards
// (SmartFallback, SkillNexus, AutoResearch, AuditTrail) do that for the abstract layers
// worth visualizing. This card is the directory for everything else.

type Feature = {
  label: string;
  description: string;
  url?: string;
  icon: React.ComponentType<{ className?: string }>;
  scope: "openclaw" | "hermes";
};

const FEATURES: Feature[] = [
  // === OpenClaw native ===
  {
    label: "Control UI",
    description: "OpenClaw's bundled web UI — agent list, session viewer, model picker. Runs in the openclaw-gateway service.",
    url: "http://127.0.0.1:18789/",
    icon: Network,
    scope: "openclaw",
  },
  {
    label: "Agents Dashboard",
    description: "Per-agent view: active sessions, current model, recent tools used.",
    url: "http://127.0.0.1:18789/agents",
    icon: Bot,
    scope: "openclaw",
  },
  {
    label: "Models Browser",
    description: "openclaw.json catalog viewer + auth-overview. Same source feeding Smart Fallback's registry.",
    url: "http://127.0.0.1:18789/dashboard",
    icon: Boxes,
    scope: "openclaw",
  },
  {
    label: "Gateway API",
    description: "Raw gateway endpoints (v1/agents, v1/sessions, etc.). Useful for scripted integrations.",
    url: "http://127.0.0.1:18789/v1/agents",
    icon: Server,
    scope: "openclaw",
  },
  {
    label: "OpenShell",
    description: "Native shell wrapper around openclaw. Lives at ~/.openclaw/workspace/OpenShell — has its own bundled skills under .claude/.opencode/.",
    icon: ScrollText,
    scope: "openclaw",
  },

  // === Hermes native ===
  {
    label: "Hermes Dashboard (local)",
    description: "Bundled Hermes web UI on localhost:9119 — manages config, API keys, and sessions. Start it with `hermes dashboard`. This is where meru's session chip in Council Comms points.",
    url: "http://127.0.0.1:9119/",
    icon: Network,
    scope: "hermes",
  },
  {
    label: "Hermes Docs",
    description: "Official NousResearch documentation site for Hermes Agent — features, CLI reference, profiles, integrations.",
    url: "https://hermes-agent.nousresearch.com/docs/",
    icon: ScrollText,
    scope: "hermes",
  },
  {
    label: "Smart Model Router",
    description: "Hermes's OpenAI-compatible local router on port 8877. As of 2026-05-16 delegates to Smart Fallback v5 — but the HTTP shell is native Hermes.",
    url: "http://127.0.0.1:8877/health",
    icon: Network,
    scope: "hermes",
  },
  {
    label: "Hermes CLI Sessions",
    description: "Saved sessions at ~/.hermes/sessions/. The Hermes CLI ships with its own session viewer and replay tools — used for CLI-driven runs separate from the dashboard.",
    icon: ScrollText,
    scope: "hermes",
  },
  {
    label: "Telegram-driven runs",
    description: "Hermes-managed agents (meru) can also accept input through Telegram via the channel set in TELEGRAM_HOME_CHANNEL. The current Telegram session is tracked in ~/.openclaw/workspace/data/meru-telegram-session.json.",
    icon: ScrollText,
    scope: "hermes",
  },
  {
    label: "Capability Probes",
    description: "Hermes runs its own capability probe loop separately from Smart Fallback's. Outputs land in ~/.hermes/model-router/health.json (legacy; v5 source-of-truth now).",
    icon: Cpu,
    scope: "hermes",
  },
  {
    label: "Hermes Plugins",
    description: "Native plugin tree at ~/.hermes/plugins/ — includes hermes-achievements and others. Loaded at Hermes startup.",
    icon: Wrench,
    scope: "hermes",
  },
];

export function HarnessSource() {
  const [tab, setTab] = useState<"openclaw" | "hermes">("openclaw");
  const features = FEATURES.filter((f) => f.scope === tab);

  return (
    <DashboardCard
      title="Harness Source"
      subtitle="Native Features From OpenClaw + Hermes"
      headerAction={
        <span className="font-mono text-[9px] uppercase text-muted-foreground/70">
          launcher
        </span>
      }
    >
      <div className="mb-2 flex items-center gap-1 rounded border border-white/10 bg-black/20 p-1">
        <button
          type="button"
          onClick={() => setTab("openclaw")}
          className={cn(
            "flex-1 rounded px-2 py-1 font-mono text-[9px] uppercase transition-colors",
            tab === "openclaw" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5"
          )}
        >
          OpenClaw ({FEATURES.filter((f) => f.scope === "openclaw").length})
        </button>
        <button
          type="button"
          onClick={() => setTab("hermes")}
          className={cn(
            "flex-1 rounded px-2 py-1 font-mono text-[9px] uppercase transition-colors",
            tab === "hermes" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5"
          )}
        >
          Hermes ({FEATURES.filter((f) => f.scope === "hermes").length})
        </button>
      </div>

      <div className="space-y-1.5">
        {features.map((f) => {
          const Icon = f.icon;
          const interactive = Boolean(f.url);
          const Wrapper: any = interactive ? "a" : "div";
          const wrapperProps = interactive
            ? { href: f.url, target: "_blank", rel: "noreferrer" }
            : {};
          return (
            <Wrapper
              key={`${f.scope}-${f.label}`}
              {...wrapperProps}
              className={cn(
                "flex items-start gap-2 rounded border border-white/10 bg-white/[0.02] px-2 py-1.5 font-mono text-[10px]",
                interactive && "transition-colors hover:border-primary/30 hover:bg-primary/5"
              )}
              title={interactive ? f.url : undefined}
            >
              <Icon className="mt-0.5 h-3 w-3 shrink-0 text-primary/80" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-bold text-slate-200">{f.label}</span>
                  {interactive && <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" />}
                </div>
                <p className="mt-0.5 text-[9px] text-muted-foreground/80">{f.description}</p>
              </div>
            </Wrapper>
          );
        })}
      </div>
    </DashboardCard>
  );
}
