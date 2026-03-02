"use client";

import { DashboardCard } from "./DashboardCard";
import { Cpu, Database, Thermometer, WifiOff, AlertTriangle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useNexus } from "@/providers/NexusProvider";

export function SystemHealth() {
  const { state, systemHealth, url, status } = useNexus();
  
  const connected = state === "LINKED" || state === "SYNCING" || state === "RE-SYNCING";
  const stats = systemHealth || { cpu_load: 0, ram_used: 0, cpu_temp: 0, uptime: 0 };
  const isDegraded = status === "DEGRADED" || state === "RE-SYNCING";

  const isHighLoad = stats.cpu_load > 50;
  const isCriticalLoad = stats.cpu_load > 80;
  
  // Reactive Pulse: Speeds up and intensifies based on CPU load
  const pulseSpeed = isCriticalLoad ? "0.5s" : isHighLoad ? "1.2s" : "3.5s";
  const glowColor = isCriticalLoad 
    ? "rgba(239, 68, 68, 0.4)" 
    : isHighLoad 
    ? "rgba(0, 255, 255, 0.3)" 
    : "rgba(0, 255, 255, 0.1)";

  return (
    <DashboardCard 
      title="System Health" 
      subtitle="Hardware Intelligence Uplink" 
      variant={connected ? (isHighLoad ? "cyan" : "default") : "default"}
      className={cn(
        "transition-all duration-500 min-h-[300px] relative",
        !connected && "border-destructive/60 bg-destructive/5 shadow-[0_0_20px_rgba(239,68,68,0.1)]"
      )}
      style={connected ? {
        boxShadow: `0 0 30px ${glowColor}`,
        animation: `pulse-soft ${pulseSpeed} ease-in-out infinite`
      } : {}}
      headerAction={
        isDegraded && (
          <div className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded border animate-pulse",
            state === "RE-SYNCING" ? "bg-yellow-500/10 border-yellow-500/30" : "bg-yellow-500/10 border-yellow-500/30"
          )}>
            <AlertTriangle className="w-3 h-3 text-yellow-500" />
            <span className="font-mono text-[8px] text-yellow-500 uppercase font-bold">
              {state === "RE-SYNCING" ? "RE-SYNCING" : "STALE_DATA"}
            </span>
          </div>
        )
      }
    >
      {state === "OFFLINE" && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md rounded-xl p-6 text-center">
            <WifiOff className="w-12 h-12 text-destructive mb-4 animate-glitch" />
            <h3 className="text-destructive font-mono-readout font-bold text-sm tracking-widest animate-pulse uppercase">
              {state}_SIGNAL_LOST
            </h3>
            <div className="mt-4 p-2 border border-destructive/20 bg-destructive/10 rounded">
              <p className="text-[9px] text-destructive font-mono leading-relaxed uppercase">
                HARDWARE UPLINK OFFLINE // RUN TOGGLE-ROUTER.BAT TO RE-ESTABLISH
              </p>
              <p className="text-[8px] text-destructive/70 font-mono mt-1 italic">
                Target: {url}
              </p>
            </div>
        </div>
      )}

      <div className={cn("space-y-6 py-2 transition-opacity duration-300", !connected && "opacity-20")}>
        <div className="space-y-2">
          <div className="flex items-center justify-between font-mono-readout">
            <span className="flex items-center gap-2">
              <Cpu className={cn("w-3 h-3", connected ? "text-primary animate-pulse" : "text-muted-foreground")} /> CPU_CORE_LOAD
            </span>
            <span className={cn("font-bold", isHighLoad ? "text-primary" : "text-foreground")}>
              {connected ? `${stats.cpu_load}%` : "---"}
            </span>
          </div>
          <Progress value={stats.cpu_load} className={cn("h-1.5 bg-white/5", isCriticalLoad && "bg-destructive/20")} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between font-mono-readout">
            <span className="flex items-center gap-2">
              <Database className={cn("w-3 h-3", connected ? "text-secondary" : "text-muted-foreground")} /> MEMORY_ALLOCATION
            </span>
            <span className={cn("font-bold", connected ? "text-secondary" : "text-muted-foreground")}>
              {connected ? `${stats.ram_used}%` : "---"}
            </span>
          </div>
          <Progress value={stats.ram_used} className="h-1.5 bg-white/5" />
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-white/5">
          <div className="text-center">
            <p className="font-mono-readout text-[9px] text-muted-foreground mb-1">CORE_TEMP</p>
            <div className="flex items-center justify-center gap-1">
               <Thermometer className={cn("w-3 h-3", stats.cpu_temp > 70 ? "text-destructive animate-bounce" : "text-destructive/80")} />
               <p className="text-lg font-bold font-mono text-foreground">
                {connected ? stats.cpu_temp : "--"}<span className="text-[10px] ml-0.5">°C</span>
               </p>
            </div>
          </div>
          <div className="text-center">
            <p className="font-mono-readout text-[9px] text-muted-foreground mb-1">SYSTEM_UPTIME</p>
            <p className="text-lg font-bold font-mono text-foreground">
              {connected ? Math.floor(stats.uptime / 3600) : "--"}<span className="text-[10px] ml-0.5">HR</span>
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mt-2">
          <div className={cn(
            "w-2 h-2 rounded-full",
            connected ? (state === "RE-SYNCING" ? "bg-yellow-500 animate-pulse" : "bg-secondary animate-pulse") : "bg-destructive"
          )} />
          <span className={cn(
            "font-mono-readout text-[10px]",
            connected ? (state === "RE-SYNCING" ? "text-yellow-500" : "text-secondary") : "text-destructive font-bold"
          )}>
            {connected ? `NEXUS_${state}` : "SIGNAL_INTERRUPTED"}
          </span>
        </div>
      </div>
    </DashboardCard>
  );
}
