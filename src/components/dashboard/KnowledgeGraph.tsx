"use client";

import { DashboardCard } from "./DashboardCard";
import { Activity, Cpu, Lock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNexus } from "@/providers/NexusProvider";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function KnowledgeGraph() {
  const { state, knowledgeGraph, killProcess } = useNexus();
  
  const connected = state === "LINKED" || state === "SYNCING";
  const data = knowledgeGraph || { nodes: [], total_threads: 0 };

  return (
    <DashboardCard 
      title="Intelligence Graph" 
      subtitle="Live Process Mapping" 
      headerAction={<Activity className={cn("w-4 h-4", connected ? "text-primary animate-pulse" : "text-muted-foreground")} />}
    >
      <div className="h-[300px] flex flex-col items-center justify-center border border-white/5 rounded-lg bg-black/40 relative overflow-hidden group">
        {!connected ? (
          <div className="relative z-10 flex flex-col items-center p-6 text-center">
            <div className="p-4 rounded-full bg-black/40 border border-destructive/30 mb-4 animate-pulse">
              <Lock className="w-8 h-8 text-destructive/60" />
            </div>
            <h4 className="font-headline font-bold text-sm text-destructive/80 uppercase tracking-tighter animate-glitch">
              {state}_LOST
            </h4>
            <div className="mt-4 p-2 border border-destructive/20 bg-destructive/5 rounded max-w-[220px]">
              <p className="font-mono text-[9px] text-destructive/70 leading-relaxed uppercase">
                HARDWARE UPLINK OFFLINE // RUN TOGGLE-ROUTER.BAT TO RE-ESTABLISH
              </p>
            </div>
          </div>
        ) : (
          <div className="w-full h-full p-4 relative overflow-hidden">
            {/* Central Core */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
              <div className="w-14 h-14 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center animate-pulse shadow-[0_0_30px_rgba(0,255,255,0.4)]">
                <Cpu className="w-7 h-7 text-primary" />
              </div>
              <p className="absolute top-full left-1/2 -translate-x-1/2 mt-3 font-mono-readout text-[9px] text-primary whitespace-nowrap font-bold">
                CORE_THREADS: {data.total_threads}
              </p>
            </div>

            {/* Orbiting Process Nodes */}
            <TooltipProvider>
              {data.nodes.map((node: any, i: number) => {
                const angle = (i / data.nodes.length) * 2 * Math.PI;
                const radius = 85 + (i % 2 === 0 ? 15 : -15);
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                const size = Math.max(10, Math.min(45, 10 + (node.usage / 100) * 150));

                return (
                  <div 
                    key={node.id}
                    className="absolute top-1/2 left-1/2 transition-all duration-1000 ease-in-out"
                    style={{ 
                      transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` 
                    }}
                  >
                    <div className="group relative">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div 
                            className={cn(
                              "rounded-full transition-transform group-hover:scale-150 cursor-crosshair relative",
                              node.usage > 5 ? "bg-secondary/60 border-secondary shadow-[0_0_15px_rgba(34,197,94,0.3)]" : "bg-primary/40 border-primary/60"
                            )}
                            style={{ 
                              width: `${size}px`, 
                              height: `${size}px`,
                              borderWidth: '1px'
                            }}
                          >
                            <button 
                              onClick={(e) => { e.stopPropagation(); killProcess(node.id); }}
                              className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-destructive rounded-full p-0.5"
                            >
                              <XCircle className="w-2.5 h-2.5 text-white" />
                            </button>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="bg-black/90 border-primary/30 p-2">
                          <p className="font-mono text-[9px] text-primary">PID:{node.id} <span className="text-secondary">{node.name}</span></p>
                          <p className="font-mono text-[8px] text-muted-foreground">LOAD: {node.usage.toFixed(1)}%</p>
                          <p className="font-mono text-[7px] text-destructive uppercase mt-1">Click X to Terminate</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </TooltipProvider>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
