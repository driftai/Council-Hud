"use client";

import { useState } from "react";
import { useNexus } from "@/providers/NexusProvider";
import { DashboardCard } from "./DashboardCard";
import { Terminal, Cpu, FileJson, Brain, Zap, Trash2, FileText, Code, Sparkles, Copy, Check } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<string, any> = {
  HARDWARE: Cpu,
  FILESYSTEM: FileJson,
  COGNITIVE_LOG: Brain,
  FILESYSTEM_TREE: Zap,
  FILE_CONTENT: FileText,
  COMMAND: Terminal,
  NEURAL: Sparkles,
};

const TYPE_COLORS: Record<string, string> = {
  HARDWARE: "text-secondary",
  FILESYSTEM: "text-primary",
  COGNITIVE_LOG: "text-purple-400",
  FILESYSTEM_TREE: "text-cyan-400",
  FILE_CONTENT: "text-yellow-400",
  COMMAND: "text-orange-400",
  NEURAL: "text-primary",
  GENERIC: "text-muted-foreground",
};

export function NexusLogs() {
  const { nexusLogs, state, clearLogs } = useNexus();
  const [copied, setCopied] = useState(false);
  const connected = state === "LINKED";

  const handleCopyLogs = () => {
    if (nexusLogs.length === 0) return;

    const logText = nexusLogs.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      const payloadString = typeof log.payload === 'string' 
        ? log.payload 
        : log.type === 'FILE_CONTENT' 
          ? `READ: ${log.payload?.filepath || 'Unknown'}` 
          : JSON.stringify(log.payload || {});
      return `[${timestamp}] ${log.type}: ${payloadString}`;
    }).join('\n');

    navigator.clipboard.writeText(logText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <DashboardCard 
      title="Nexus System Logs" 
      subtitle="Neural Backbone Activity"
      headerAction={
        <div className="flex items-center gap-3">
          <button 
            onClick={clearLogs}
            disabled={nexusLogs.length === 0}
            className="flex items-center gap-1.5 px-2 py-1 rounded border border-white/10 bg-white/5 hover:bg-white/10 transition-all group disabled:opacity-30 disabled:cursor-not-allowed text-muted-foreground hover:text-destructive"
            title="Clear all logs"
          >
            <Trash2 className="w-3 h-3 group-hover:scale-110 transition-transform" />
            <span className="text-[9px] font-mono font-bold uppercase">Clear</span>
          </button>
          <button 
            onClick={handleCopyLogs}
            disabled={nexusLogs.length === 0}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded border border-white/10 bg-white/5 hover:bg-white/10 transition-all group disabled:opacity-30 disabled:cursor-not-allowed",
              copied ? "text-secondary border-secondary/30" : "text-muted-foreground hover:text-primary"
            )}
            title="Copy all logs"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" />
                <span className="text-[9px] font-mono font-bold uppercase">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 group-hover:scale-110 transition-transform" />
                <span className="text-[9px] font-mono font-bold uppercase">Copy</span>
              </>
            )}
          </button>
          <Terminal className={cn("w-4 h-4", connected ? "text-primary animate-pulse" : "text-muted-foreground")} />
        </div>
      }
    >
      <ScrollArea className="h-[250px] -mx-4 px-4">
        <div className="space-y-3 py-2">
          {nexusLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 opacity-20">
              <Terminal className="w-8 h-8 mb-2" />
              <p className="font-mono text-[9px] uppercase tracking-tighter">Awaiting Packets...</p>
            </div>
          ) : (
            nexusLogs.map((log, i) => {
              const Icon = TYPE_ICONS[log.type] || Terminal;
              const color = TYPE_COLORS[log.type] || TYPE_COLORS.GENERIC;
              
              return (
                <div key={i} className="flex gap-3 group animate-in fade-in slide-in-from-left-2 duration-300">
                  <div className={cn("mt-1 shrink-0", color)}>
                    <Icon className="w-3 h-3" />
                  </div>
                  <div className={cn("flex-1 min-w-0 font-mono text-[9px] border-l border-white/5 pl-3 transition-colors", 
                    log.type === "COMMAND" || log.type === "NEURAL" ? "bg-primary/5" : "group-hover:border-primary/30"
                  )}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={cn("font-bold uppercase tracking-widest", color)}>
                        {log.type}
                      </span>
                      <span className="text-muted-foreground text-[8px]">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-foreground/80 break-words line-clamp-2 italic">
                      {typeof log.payload === 'string' 
                        ? log.payload 
                        : log.type === 'FILE_CONTENT' 
                          ? `READ: ${log.payload?.filepath?.split('\\').pop() || 'Unknown'}`
                          : (log.payload ? JSON.stringify(log.payload) : 'No Data').substring(0, 100)}
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
