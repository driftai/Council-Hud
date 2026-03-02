"use client";

import { useEffect, useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Radio } from "lucide-react";

type Agent = {
  id: string;
  name: string;
  role: string;
  status: "online" | "offline" | "busy";
  lastActivity: string;
};

const INITIAL_AGENTS: Agent[] = [
  { id: "1", name: "Alpha-9", role: "Logic Core", status: "online", lastActivity: "Processing query 402" },
  { id: "2", name: "Sentry-X", role: "Defense", status: "busy", lastActivity: "Firewall optimization" },
  { id: "3", name: "Analyst-B", role: "Data Mining", status: "online", lastActivity: "Indexing stream B2" },
  { id: "4", name: "Ghost-V", role: "Infiltration", status: "offline", lastActivity: "Dormant" },
  { id: "5", name: "Oracle", role: "Predictive", status: "online", lastActivity: "Synthesizing trends" },
];

export function AgentRoster() {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);

  useEffect(() => {
    const interval = setInterval(() => {
      setAgents((current) =>
        current.map((agent) => {
          if (Math.random() > 0.8) {
            const statuses: Agent["status"][] = ["online", "offline", "busy"];
            return {
              ...agent,
              status: statuses[Math.floor(Math.random() * statuses.length)],
            };
          }
          return agent;
        })
      );
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <DashboardCard title="Active Agents" subtitle="Command & Control" headerAction={<Radio className="w-4 h-4 text-primary animate-pulse" />}>
      <ScrollArea className="h-[300px] pr-4">
        <div className="space-y-4 py-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="group flex items-center gap-3 p-2 rounded-lg transition-all hover:bg-white/5 cursor-pointer border border-transparent hover:border-white/10"
            >
              <div className="relative">
                <Avatar className="w-10 h-10 border border-white/20">
                  <AvatarImage src={`https://picsum.photos/seed/${agent.id}/100/100`} />
                  <AvatarFallback className="bg-muted text-[10px] font-mono">{agent.id}</AvatarFallback>
                </Avatar>
                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${
                  agent.status === "online" ? "bg-secondary" :
                  agent.status === "busy" ? "bg-yellow-500" : "bg-gray-500"
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className="font-headline font-semibold text-sm truncate">{agent.name}</h4>
                  <Badge variant="outline" className="text-[9px] h-4 border-white/20 px-1 font-mono uppercase">
                    {agent.role}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground truncate font-mono mt-0.5">
                  {agent.lastActivity}
                </p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </DashboardCard>
  );
}
