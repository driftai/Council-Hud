"use client";

import { SystemHealth } from "@/components/dashboard/SystemHealth";
import { AgentRoster } from "@/components/dashboard/AgentRoster";
import { NeuralVisualizer } from "@/components/dashboard/NeuralVisualizer";
import { KnowledgeGraph } from "@/components/dashboard/KnowledgeGraph";
import { FileWatcher } from "@/components/dashboard/FileWatcher";
import { NexusLogs } from "@/components/dashboard/NexusLogs";
import { NeuralCommand } from "@/components/dashboard/NeuralCommand";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { Shield, Zap, Bell, Link2, Loader2, Cpu, Lock, Unlock, Radio, X, FileCode, RefreshCcw, Signal, SignalHigh, SignalLow, Sparkles, Key } from "lucide-react";
import { useUplink } from "@/hooks/use-uplink";
import { useNexus } from "@/providers/NexusProvider";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function Home() {
  const { url, updateUrl } = useUplink();
  const { state, authorize, fileContent, setFileContent, consecutiveFailures, nexusKey, updateKey } = useNexus();
  const [tempUrl, setTempUrl] = useState(url);
  const [tempKey, setTempKey] = useState(nexusKey);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setTempUrl(url);
    setTempKey(nexusKey);
  }, [url, nexusKey]);

  const handleSave = () => {
    updateUrl(tempUrl);
    updateKey(tempKey);
    setIsOpen(false);
  };

  const showOverlay = state === "HANDSHAKE" || (state === "SYNCING" && consecutiveFailures > 0);

  return (
    <main className="min-h-screen bg-[#020617] text-slate-100 selection:bg-cyan-500/30 overflow-x-hidden">
      {showOverlay && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-500">
          <div className="relative">
            <Loader2 className="w-16 h-16 text-primary animate-spin mb-6" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Radio className="w-6 h-6 text-primary animate-pulse" />
            </div>
          </div>
          <h2 className="font-headline font-black text-2xl tracking-[0.2em] uppercase text-primary animate-pulse">
            Nexus_Sync_Initiated
          </h2>
          <p className="font-mono text-xs text-muted-foreground mt-2 tracking-widest">
            ESTABLISHING CLOUDFLARE BRIDGE // {state}
          </p>
          <div className="mt-8 w-48 h-1 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-primary animate-[progress_2s_ease-in-out_infinite]" />
          </div>
        </div>
      )}

      {fileContent && (
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
          <div className="bg-[#020617] border border-primary/20 w-full max-w-4xl h-[80vh] rounded-xl flex flex-col shadow-[0_0_50px_rgba(0,255,255,0.1)]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <FileCode className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-primary">Remote_Inspector</h3>
                  <p className="text-[10px] font-mono text-muted-foreground truncate max-w-[500px]">{fileContent.path}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setFileContent(null)} className="hover:bg-white/5">
                <X className="w-5 h-5" />
              </Button>
            </div>
            <ScrollArea className="flex-1 p-6 bg-black/40">
              <pre className="font-mono text-xs text-slate-300 sliding-relaxed whitespace-pre-wrap">
                {fileContent.content}
              </pre>
            </ScrollArea>
            <div className="p-4 border-t border-white/5 flex justify-end">
              <p className="text-[9px] font-mono text-muted-foreground uppercase">Buffer Security: Max 50KB Transmitted</p>
            </div>
          </div>
        </div>
      )}

      <header className="h-16 border-b border-white/5 bg-black/40 backdrop-blur-md sticky top-0 z-50 px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-primary/20 border border-primary/40 rounded flex items-center justify-center">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-headline font-black text-xl tracking-tighter uppercase flex items-center gap-2">
              Council <span className="text-primary">HUD</span>
            </h1>
            <div className="flex items-center gap-2">
              <p className="font-mono-readout text-[9px] text-muted-foreground">
                v3.2.0 // PLATINUM_MONOREPO // <span className={cn(
                  state === "LINKED" ? "text-secondary" : 
                  state === "RE-SYNCING" ? "text-yellow-500 animate-pulse" :
                  "text-destructive"
                )}>
                  NEXUS_{state}
                </span>
              </p>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full shadow-[0_0_5px_currentColor]",
                consecutiveFailures === 0 ? "bg-secondary text-secondary" :
                consecutiveFailures < 10 ? "bg-yellow-500 text-yellow-500 animate-pulse" :
                "bg-destructive text-destructive"
              )} />
            </div>
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-8 font-mono-readout text-[10px]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
            <span className="text-foreground">AI_OPERATOR_ONLINE</span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground uppercase">Shield Status</span>
            <span className={cn("font-bold", nexusKey ? "text-secondary" : "text-destructive")}>
              {nexusKey ? "OMEGA_ACTIVE" : "NO_KEY"}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground uppercase">Uplink</span>
            <span className="text-primary truncate max-w-[150px]">{url.replace('https://', '').replace('http://', '')}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <button className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-all group">
                <Link2 className="w-4 h-4 text-primary group-hover:rotate-12 transition-transform" />
                <span className="font-mono-readout text-[10px] text-primary">Configure Uplink</span>
              </button>
            </DialogTrigger>
            <DialogContent className="glass-card border-white/10 text-slate-100">
              <DialogHeader>
                <DialogTitle className="font-headline uppercase tracking-widest text-primary">Nexus Configuration</DialogTitle>
                <DialogDescription className="text-slate-400 font-mono text-xs">
                  Enter the Cloudflare Tunnel URL and your unique Nexus Security Key to bridge the HUD.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-mono-readout text-muted-foreground uppercase">Primary Tunnel URL</label>
                  <Input 
                    value={tempUrl} 
                    onChange={(e) => setTempUrl(e.target.value)}
                    placeholder="https://your-tunnel.trycloudflare.com"
                    className="bg-black/40 border-white/10 text-primary font-mono h-10"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-mono-readout text-muted-foreground uppercase flex items-center gap-2">
                    <Key className="w-3 h-3 text-secondary" /> Nexus Security Key
                  </label>
                  <Input 
                    type="password"
                    value={tempKey} 
                    onChange={(e) => setTempKey(e.target.value)}
                    placeholder="Enter Omega Key from local terminal"
                    className="bg-black/40 border-white/10 text-secondary font-mono h-10"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsOpen(false)} className="border-white/10 hover:bg-white/5">Cancel</Button>
                <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:bg-primary/90">Synchronize Nexus</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="h-8 w-px bg-white/10 mx-1" />
          
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10 transition-colors">
            <div className="w-6 h-6 rounded-full bg-primary/40 border border-primary/20 flex items-center justify-center text-[10px] font-bold">JD</div>
            <span className="font-mono-readout text-[10px]">Nexus_Admin</span>
          </div>
        </div>
      </header>

      <div className="p-4 md:p-6 lg:p-8 max-w-[1800px] mx-auto pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <SystemHealth />
            <NeuralCommand />
            <div className="p-6 rounded-xl bg-gradient-to-br from-primary/20 to-transparent border border-primary/10 group cursor-pointer hover:border-primary/40 transition-all">
                <Zap className="w-8 h-8 text-primary mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-headline font-bold text-sm">Turbo Sync</h3>
                <p className="text-xs text-muted-foreground mt-1">Force immediate agent state updates across all clusters.</p>
            </div>
          </div>

          <div className="lg:col-span-6 space-y-6">
            <NeuralVisualizer />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <KnowledgeGraph />
                <NexusLogs />
            </div>
          </div>

          <div className="lg:col-span-3 space-y-6">
            <AgentRoster />
            <FileWatcher />
            <DashboardCard title="Uplink Telemetry" subtitle="Signal Health">
                <div className="flex flex-col items-center justify-center py-6">
                    <div className="relative w-32 h-32 flex items-center justify-center">
                        <div className="absolute inset-0 border-4 border-primary/20 border-dashed rounded-full animate-[spin_10s_linear_infinite]" />
                        <div className="absolute inset-2 border-2 border-secondary/20 rounded-full animate-[spin_6s_linear_infinite_reverse]" />
                        <div className="z-10 text-center">
                            <p className="text-2xl font-bold font-mono">{consecutiveFailures > 0 ? "!" : "1"}</p>
                            <p className="text-[8px] font-mono-readout text-muted-foreground uppercase">{state === "RE-SYNCING" ? "Stabilizing" : "Nexus Node"}</p>
                        </div>
                    </div>
                    <div className="mt-6 w-full space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-mono">
                            <span className="text-muted-foreground">Uplink Status</span>
                            <span className={cn(
                              "font-bold", 
                              state === "LINKED" ? "text-secondary" : 
                              state === "RE-SYNCING" ? "text-yellow-500" :
                              "text-destructive"
                            )}>
                              {state}
                            </span>
                        </div>
                        <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full transition-all duration-500",
                              consecutiveFailures === 0 ? "bg-secondary w-full" : 
                              state === "RE-SYNCING" ? "bg-yellow-500 w-1/2" : 
                              "bg-destructive w-0"
                            )} 
                          />
                        </div>
                    </div>
                </div>
            </DashboardCard>
          </div>
        </div>
      </div>
      
      <footer className="fixed bottom-0 left-0 w-full h-8 bg-black/80 backdrop-blur-md border-t border-white/5 z-50 flex items-center justify-between px-6">
        <div className="flex items-center gap-6 font-mono-readout text-[8px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full shadow-[0_0_3px_currentColor]", 
                state === "LINKED" ? "bg-secondary text-secondary" : 
                state === "RE-SYNCING" ? "bg-yellow-500 text-yellow-500 animate-pulse" :
                "bg-destructive text-destructive"
              )} /> 
              {state}
            </span>
            <span className="hidden sm:inline">LOC: 37.7749° N, 122.4194° W</span>
            <span className="hidden sm:inline text-primary/60 font-bold">AI_OPERATOR_ACTIVE</span>
        </div>
        <div className="flex items-center gap-4 font-mono-readout text-[8px] text-muted-foreground">
            <span className="animate-pulse text-primary font-bold uppercase truncate max-w-[200px]">Signal: {url}</span>
            <div className="flex items-center gap-2 bg-white/5 px-2 py-0.5 border border-white/10 rounded">
              <span>SYSTEM:V3_AGENTIC</span>
              <div className={cn(
                "w-1 h-1 rounded-full",
                consecutiveFailures === 0 ? "bg-secondary" : "bg-yellow-500 animate-ping"
              )} />
            </div>
        </div>
      </footer>
    </main>
  );
}
