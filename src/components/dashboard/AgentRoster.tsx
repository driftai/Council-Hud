"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Radio, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

type CouncilSession = {
  name: string;
  agent: string;
  role: string;
  mode: "operator" | "live" | "viewer" | "bridge";
  connectedAt: number;
  topics: string[];
};

type CouncilStatus = {
  ok: boolean;
  sessions: CouncilSession[];
  error?: string | null;
};

type AgentGroup = {
  agent: string;
  role: string;
  mode: CouncilSession["mode"];
  oldestConnectedAt: number;
  newestConnectedAt: number;
  topics: string[];
  sessionNames: string[];
};

const MODE_PRIORITY: Record<CouncilSession["mode"], number> = {
  operator: 0,
  live: 1,
  viewer: 2,
  bridge: 3,
};

function groupSessionsByAgent(sessions: CouncilSession[]): AgentGroup[] {
  const groups = new Map<string, AgentGroup>();
  for (const session of sessions) {
    const key = session.agent || session.name;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        agent: session.agent,
        role: session.role,
        mode: session.mode,
        oldestConnectedAt: session.connectedAt || 0,
        newestConnectedAt: session.connectedAt || 0,
        topics: [...session.topics],
        sessionNames: [session.name],
      });
      continue;
    }
    if (MODE_PRIORITY[session.mode] < MODE_PRIORITY[existing.mode]) {
      existing.mode = session.mode;
      existing.role = session.role;
    }
    if (session.connectedAt) {
      existing.oldestConnectedAt = existing.oldestConnectedAt
        ? Math.min(existing.oldestConnectedAt, session.connectedAt)
        : session.connectedAt;
      existing.newestConnectedAt = Math.max(existing.newestConnectedAt, session.connectedAt);
    }
    for (const topic of session.topics) {
      if (topic && !existing.topics.includes(topic)) existing.topics.push(topic);
    }
    if (!existing.sessionNames.includes(session.name)) existing.sessionNames.push(session.name);
  }
  return Array.from(groups.values()).sort((a, b) => {
    const modeDelta = MODE_PRIORITY[a.mode] - MODE_PRIORITY[b.mode];
    if (modeDelta !== 0) return modeDelta;
    return a.agent.localeCompare(b.agent);
  });
}

function formatConnectedAt(value: number) {
  if (!value) return "session age unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s online`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m online`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h online`;
}

function getModeClass(mode: CouncilSession["mode"]) {
  if (mode === "operator") return "border-primary/30 text-primary";
  if (mode === "live") return "border-secondary/30 text-secondary";
  if (mode === "viewer") return "border-fuchsia-400/30 text-fuchsia-300";
  return "border-white/20 text-muted-foreground";
}

export function AgentRoster() {
  const [status, setStatus] = useState<CouncilStatus>({ ok: false, sessions: [] });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        const response = await fetch("/api/council/status", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!cancelled) {
          setStatus({
            ok: Boolean(data.ok),
            sessions: Array.isArray(data.sessions) ? data.sessions : [],
            error: data.error || null,
          });
        }
      } catch (error: any) {
        if (!cancelled) {
          setStatus({ ok: false, sessions: [], error: error?.message || "Council status unavailable." });
        }
      }
    };

    loadStatus();
    const statusInterval = setInterval(loadStatus, 8000);
    const clockInterval = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(statusInterval);
      clearInterval(clockInterval);
    };
  }, []);

  const sessions = useMemo(() => status.sessions, [status.sessions, now]);
  const groupedAgents = useMemo(() => groupSessionsByAgent(sessions), [sessions, now]);

  return (
    <DashboardCard
      title="Council Agents"
      subtitle="IPC Session Presence"
      headerAction={
        status.ok ? (
          <Radio className="h-4 w-4 animate-pulse text-secondary" />
        ) : (
          <WifiOff className="h-4 w-4 text-destructive" />
        )
      }
    >
      <ScrollArea className="h-[260px] pr-4">
        <div className="space-y-3 py-1">
          {groupedAgents.length === 0 ? (
            <div className="rounded border border-white/10 bg-black/20 p-3 font-mono text-[10px] text-muted-foreground">
              {status.error || "No council sessions reported."}
            </div>
          ) : (
            groupedAgents.map((group) => {
              const sessionCount = group.sessionNames.length;
              const topicsLabel = group.topics.length > 0 ? group.topics.join(", ") : "no topic";
              const sessionTitle = sessionCount > 1
                ? `Sessions: ${group.sessionNames.join(", ")}`
                : group.sessionNames[0] || group.agent;
              return (
                <div
                  key={group.agent}
                  title={sessionTitle}
                  className="group flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-2 transition-colors hover:border-primary/30 hover:bg-white/[0.04]"
                >
                  <div className="relative">
                    <Avatar className="h-10 w-10 border border-white/20 bg-black/30">
                      <AvatarFallback className="bg-muted font-mono text-[10px] uppercase">
                        {group.agent.slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background",
                      status.ok ? "bg-secondary" : "bg-destructive"
                    )} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="truncate font-headline text-sm font-semibold capitalize">
                        {group.agent}
                      </h4>
                      <div className="flex items-center gap-1">
                        {sessionCount > 1 && (
                          <Badge variant="outline" className="h-4 px-1 font-mono text-[8px] uppercase border-primary/30 text-primary">
                            {sessionCount}x
                          </Badge>
                        )}
                        <Badge variant="outline" className={cn("h-4 px-1 font-mono text-[8px] uppercase", getModeClass(group.mode))}>
                          {group.mode}
                        </Badge>
                      </div>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {group.role} / {formatConnectedAt(group.oldestConnectedAt || group.newestConnectedAt)}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[8px] uppercase text-primary/70">
                      {topicsLabel}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </DashboardCard>
  );
}
