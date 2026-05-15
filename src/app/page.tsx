"use client";

import { SystemHealth } from "@/components/dashboard/SystemHealth";
import { AgentRoster } from "@/components/dashboard/AgentRoster";
import { CouncilComms } from "@/components/dashboard/CouncilComms";
import { SmartFallback } from "@/components/dashboard/SmartFallback";
import { NeuralVisualizer } from "@/components/dashboard/NeuralVisualizer";
import { KnowledgeGraph } from "@/components/dashboard/KnowledgeGraph";
import { FileWatcher } from "@/components/dashboard/FileWatcher";
import { NexusLogs } from "@/components/dashboard/NexusLogs";
import { NeuralCommand } from "@/components/dashboard/NeuralCommand";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { Shield, Zap, Bell, Link2, Loader2, Cpu, Lock, Unlock, Radio, X, FileCode, RefreshCcw, Signal, SignalHigh, SignalLow, Sparkles, Key, Edit3, Save, Undo2, AlertTriangle } from "lucide-react";
import { useNexus } from "@/providers/NexusProvider";
import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { NvidiaModelOption, NvidiaModelSort } from "@/lib/nvidia-models";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MODEL_SORT_LABELS: Record<NvidiaModelSort, string> = {
  recommended: "Recommended",
  score: "Usefulness Score",
  reasoning: "Reasoning",
  coding: "Coding",
  speed: "Speed",
  name: "Name",
  provider: "Provider",
};

export default function Home() {
  const {
    state,
    fileContent,
    setFileContent,
    writeFile,
    consecutiveFailures,
    nexusKey,
    updateKey,
    url,
    updateUrl,
    systemHealth,
    knowledgeGraph,
    lastUpdate,
    refreshTelemetry,
    workingDirectory,
  } = useNexus();
  const [tempUrl, setTempUrl] = useState(url);
  const [tempKey, setTempKey] = useState(nexusKey);
  const [isOpen, setIsOpen] = useState(false);
  const [isTurboSyncing, setIsTurboSyncing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [draftFileContent, setDraftFileContent] = useState("");
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [fileEditorError, setFileEditorError] = useState<string | null>(null);
  const [tempNvidiaKey, setTempNvidiaKey] = useState("");
  const [nvidiaKeyConfigured, setNvidiaKeyConfigured] = useState(false);
  const [isSavingNvidiaKey, setIsSavingNvidiaKey] = useState(false);
  const [nvidiaKeyMessage, setNvidiaKeyMessage] = useState<string | null>(null);
  const [nvidiaModels, setNvidiaModels] = useState<NvidiaModelOption[]>([]);
  const [modelSort, setModelSort] = useState<NvidiaModelSort>("recommended");
  const [selectedNvidiaModel, setSelectedNvidiaModel] = useState("");
  const [tempNvidiaModel, setTempNvidiaModel] = useState("");
  const [isLoadingNvidiaModels, setIsLoadingNvidiaModels] = useState(false);
  const [isSavingNvidiaModel, setIsSavingNvidiaModel] = useState(false);
  const [nvidiaModelMessage, setNvidiaModelMessage] = useState<string | null>(null);
  const [activeSystemInstruction, setActiveSystemInstruction] = useState("");
  const [systemInstructionDraft, setSystemInstructionDraft] = useState("");
  const [defaultSystemInstruction, setDefaultSystemInstruction] = useState("");
  const [isLoadingSystemInstruction, setIsLoadingSystemInstruction] = useState(false);
  const [isSavingSystemInstruction, setIsSavingSystemInstruction] = useState(false);
  const [systemInstructionMessage, setSystemInstructionMessage] = useState<string | null>(null);

  useEffect(() => {
    setTempUrl(url);
    setTempKey(nexusKey);
  }, [url, nexusKey]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const loadNvidiaModels = useCallback(async () => {
    setIsLoadingNvidiaModels(true);
    setNvidiaModelMessage(null);
    try {
      const response = await fetch(`/api/runtime/nvidia-models?sort=${modelSort}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to load NVIDIA models.");
      }

      setNvidiaKeyConfigured(Boolean(data.configured));
      setNvidiaModels(Array.isArray(data.models) ? data.models : []);
      setSelectedNvidiaModel(data.selectedModel || "");
      setTempNvidiaModel(data.selectedModel || "");
      if (data.error) {
        setNvidiaModelMessage(data.error);
      }
    } catch (error: any) {
      setNvidiaModels([]);
      setNvidiaModelMessage(error?.message || "Failed to load NVIDIA models.");
    } finally {
      setIsLoadingNvidiaModels(false);
    }
  }, [modelSort]);

  const loadSystemInstruction = useCallback(async () => {
    setIsLoadingSystemInstruction(true);
    setSystemInstructionMessage(null);
    try {
      const response = await fetch("/api/runtime/nexus-system-instruction", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to load system instruction.");
      }

      setActiveSystemInstruction(data.instruction || "");
      setSystemInstructionDraft(data.instruction || "");
      setDefaultSystemInstruction(data.defaultInstruction || "");
    } catch (error: any) {
      setSystemInstructionMessage(error?.message || "Failed to load system instruction.");
    } finally {
      setIsLoadingSystemInstruction(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadNvidiaModels();
  }, [isOpen, loadNvidiaModels]);

  useEffect(() => {
    if (!isOpen) return;
    loadSystemInstruction();
  }, [isOpen, loadSystemInstruction]);

  useEffect(() => {
    if (!fileContent) {
      setDraftFileContent("");
      setIsEditingFile(false);
      setFileEditorError(null);
      return;
    }

    setDraftFileContent(fileContent.content);
    setIsEditingFile(false);
    setFileEditorError(null);
  }, [fileContent?.path, fileContent?.content]);

  const handleSave = () => {
    updateUrl(tempUrl);
    updateKey(tempKey);
    setIsOpen(false);
  };

  const handleSaveNvidiaKey = async () => {
    const trimmedKey = tempNvidiaKey.trim();
    if (!trimmedKey || isSavingNvidiaKey) return;

    setIsSavingNvidiaKey(true);
    setNvidiaKeyMessage(null);
    try {
      const response = await fetch("/api/runtime/nvidia-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmedKey }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to save NVIDIA API key.");
      }

      setTempNvidiaKey("");
      setNvidiaKeyConfigured(true);
      setNvidiaKeyMessage("NVIDIA key stored in .env.local");
      await loadNvidiaModels();
    } catch (error: any) {
      setNvidiaKeyMessage(error?.message || "Failed to save NVIDIA API key.");
    } finally {
      setIsSavingNvidiaKey(false);
    }
  };

  const handleSaveNvidiaModel = async () => {
    if (!tempNvidiaModel || isSavingNvidiaModel) return;

    setIsSavingNvidiaModel(true);
    setNvidiaModelMessage(null);
    try {
      const response = await fetch("/api/runtime/nvidia-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: tempNvidiaModel }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to save NVIDIA model.");
      }

      setSelectedNvidiaModel(data.selectedModel || tempNvidiaModel);
      setTempNvidiaModel(data.selectedModel || tempNvidiaModel);
      setNvidiaModelMessage("Neural Command brain model updated.");
    } catch (error: any) {
      setNvidiaModelMessage(error?.message || "Failed to save NVIDIA model.");
    } finally {
      setIsSavingNvidiaModel(false);
    }
  };

  const handleSaveSystemInstruction = async () => {
    const instruction = systemInstructionDraft.trim();
    if (!instruction || isSavingSystemInstruction) return;

    setIsSavingSystemInstruction(true);
    setSystemInstructionMessage(null);
    try {
      const response = await fetch("/api/runtime/nexus-system-instruction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to save system instruction.");
      }

      setActiveSystemInstruction(data.instruction || instruction);
      setSystemInstructionDraft(data.instruction || instruction);
      setSystemInstructionMessage("System instruction updated.");
    } catch (error: any) {
      setSystemInstructionMessage(error?.message || "Failed to save system instruction.");
    } finally {
      setIsSavingSystemInstruction(false);
    }
  };

  const handleResetSystemInstruction = async () => {
    if (isSavingSystemInstruction) return;

    setIsSavingSystemInstruction(true);
    setSystemInstructionMessage(null);
    try {
      const response = await fetch("/api/runtime/nexus-system-instruction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to reset system instruction.");
      }

      setActiveSystemInstruction(data.instruction || defaultSystemInstruction);
      setSystemInstructionDraft(data.instruction || defaultSystemInstruction);
      setSystemInstructionMessage("System instruction reset to default.");
    } catch (error: any) {
      setSystemInstructionMessage(error?.message || "Failed to reset system instruction.");
    } finally {
      setIsSavingSystemInstruction(false);
    }
  };

  const handleTurboSync = async () => {
    if (isTurboSyncing) return;
    setIsTurboSyncing(true);
    try {
      await refreshTelemetry();
    } finally {
      setIsTurboSyncing(false);
    }
  };

  const handleCloseFileInspector = () => {
    setFileContent(null);
  };

  const handleStartFileEdit = () => {
    if (!fileContent) return;
    setDraftFileContent(fileContent.content);
    setFileEditorError(null);
    setIsEditingFile(true);
  };

  const handleCancelFileEdit = () => {
    setDraftFileContent(fileContent?.content || "");
    setFileEditorError(null);
    setIsEditingFile(false);
  };

  const handleSaveFileEdit = async () => {
    if (!fileContent || isSavingFile) return;

    setIsSavingFile(true);
    setFileEditorError(null);
    try {
      await writeFile(fileContent.path, draftFileContent);
      setFileContent({ path: fileContent.path, content: draftFileContent });
      setIsEditingFile(false);
    } catch (error: any) {
      setFileEditorError(error?.message || "File write failed.");
    } finally {
      setIsSavingFile(false);
    }
  };

  const showOverlay = state === "HANDSHAKE" || (state === "SYNCING" && consecutiveFailures > 0);
  const lastPacketAge = lastUpdate ? Math.max(0, Math.floor((now - lastUpdate) / 1000)) : null;
  const cpuLoad = systemHealth?.cpu_load ?? "--";
  const ramUsed = systemHealth?.ram_used ?? "--";
  const totalThreads = knowledgeGraph?.total_threads ?? "--";
  const isLocalProxy = url === "/api/nexus";
  const shieldStatus = nexusKey ? "OMEGA_ACTIVE" : isLocalProxy ? "LOCAL_PROXY" : "KEY_REQUIRED";
  const shieldStatusClass = nexusKey || isLocalProxy ? "text-secondary" : "text-yellow-500";
  const uplinkLabel = isLocalProxy
    ? "LOCAL_NEXUS_PROXY"
    : url.replace("https://", "").replace("http://", "");
  const fileHasUnsavedChanges = !!fileContent && draftFileContent !== fileContent.content;
  const selectableNvidiaModels = nvidiaModels.filter((model) => model.selectable);
  const selectedModelDetails = nvidiaModels.find((model) => model.id === tempNvidiaModel)
    || nvidiaModels.find((model) => model.id === selectedNvidiaModel)
    || null;
  const selectedModelIsDirty = !!tempNvidiaModel && tempNvidiaModel !== selectedNvidiaModel;
  const systemInstructionIsDirty = systemInstructionDraft.trim() !== activeSystemInstruction.trim();

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
              <Button variant="ghost" size="icon" onClick={handleCloseFileInspector} className="hover:bg-white/5">
                <X className="w-5 h-5" />
              </Button>
            </div>
            {isEditingFile ? (
              <div className="flex-1 bg-black/40 p-4">
                <Textarea
                  value={draftFileContent}
                  onChange={(event) => setDraftFileContent(event.target.value)}
                  spellCheck={false}
                  className="h-full min-h-full resize-none border-white/10 bg-black/60 font-mono text-xs text-slate-200 focus-visible:ring-primary"
                />
              </div>
            ) : (
              <ScrollArea className="flex-1 p-6 bg-black/40">
                <pre className="font-mono text-xs text-slate-300 sliding-relaxed whitespace-pre-wrap">
                  {fileContent.content}
                </pre>
              </ScrollArea>
            )}
            <div className="p-4 border-t border-white/5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                {fileEditorError ? (
                  <p className="flex items-center gap-2 text-[9px] font-mono uppercase text-destructive">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span className="truncate">{fileEditorError}</span>
                  </p>
                ) : (
                  <p className="text-[9px] font-mono text-muted-foreground uppercase">
                    {isEditingFile
                      ? fileHasUnsavedChanges ? "Unsaved Edits Pending" : "Edit Buffer Clean"
                      : "Buffer Security: Max 50KB Transmitted"}
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                {isEditingFile ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSavingFile}
                      onClick={handleCancelFileEdit}
                      className="h-8 border-white/10 bg-transparent text-[10px] uppercase hover:bg-white/5"
                    >
                      <Undo2 className="mr-2 h-3.5 w-3.5" />
                      Revert
                    </Button>
                    <Button
                      type="button"
                      disabled={!fileHasUnsavedChanges || isSavingFile}
                      onClick={handleSaveFileEdit}
                      className="h-8 bg-primary text-primary-foreground text-[10px] font-bold uppercase hover:bg-primary/90"
                    >
                      {isSavingFile ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
                      Save File
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    onClick={handleStartFileEdit}
                    className="h-8 bg-primary/90 text-primary-foreground text-[10px] font-bold uppercase hover:bg-primary"
                  >
                    <Edit3 className="mr-2 h-3.5 w-3.5" />
                    Edit File
                  </Button>
                )}
              </div>
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
            <span className={cn("font-bold", shieldStatusClass)}>
              {shieldStatus}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground uppercase">Uplink</span>
            <span className="text-primary truncate max-w-[150px]">{uplinkLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <button className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-all group">
                <Link2 className="w-4 h-4 text-primary group-hover:rotate-12 transition-transform" />
                <span className="font-mono-readout text-[10px] text-primary">Uplink Settings</span>
              </button>
            </DialogTrigger>
            <DialogContent className="glass-card max-h-[90vh] overflow-y-auto border-white/10 text-slate-100 sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle className="font-headline uppercase tracking-widest text-primary">Nexus Configuration</DialogTitle>
                <DialogDescription className="text-slate-400 font-mono text-xs">
                  Use the local Nexus proxy or enter a tunnel URL and Security Key to bridge the HUD.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-mono-readout text-muted-foreground uppercase">Nexus Route or Tunnel URL</label>
                  <Input 
                    value={tempUrl} 
                    onChange={(e) => setTempUrl(e.target.value)}
                    placeholder="/api/nexus or https://your-tunnel.trycloudflare.com"
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
                    placeholder="Optional for local proxy; required for direct tunnels"
                    className="bg-black/40 border-white/10 text-secondary font-mono h-10"
                  />
                </div>
                <div className="space-y-2 rounded border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-[10px] font-mono-readout text-muted-foreground uppercase flex items-center gap-2">
                      <Sparkles className="w-3 h-3 text-primary" /> NVIDIA API Key
                    </label>
                    <span className={cn("font-mono text-[8px] uppercase", nvidiaKeyConfigured ? "text-secondary" : "text-yellow-500")}>
                      {nvidiaKeyConfigured ? "Configured" : "Missing"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={tempNvidiaKey}
                      onChange={(e) => {
                        setTempNvidiaKey(e.target.value);
                        setNvidiaKeyMessage(null);
                      }}
                      placeholder="nvapi-..."
                      className="h-9 bg-black/40 border-white/10 text-primary font-mono text-xs"
                    />
                    <Button
                      type="button"
                      onClick={handleSaveNvidiaKey}
                      disabled={!tempNvidiaKey.trim() || isSavingNvidiaKey}
                      className="h-9 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {isSavingNvidiaKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                  <p className={cn(
                    "font-mono text-[8px]",
                    nvidiaKeyMessage?.includes("Failed") || nvidiaKeyMessage?.includes("only enabled") || nvidiaKeyMessage?.includes("should start")
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}>
                    {nvidiaKeyMessage || "Stored locally in .env.local for Neural Command."}
                  </p>
                  <div className="mt-4 border-t border-white/10 pt-4 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[10px] font-mono-readout text-muted-foreground uppercase">
                          Agent Brain Model
                        </p>
                        <p className="mt-1 font-mono text-[8px] text-muted-foreground">
                          {nvidiaModels.length > 0
                            ? `${selectableNvidiaModels.length}/${nvidiaModels.length} models marked brain-compatible`
                            : "Fetches live NVIDIA model ids from /v1/models"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={loadNvidiaModels}
                        disabled={isLoadingNvidiaModels || !nvidiaKeyConfigured}
                        className="h-8 shrink-0 border-white/10 bg-transparent text-[10px] uppercase hover:bg-white/5"
                      >
                        {isLoadingNvidiaModels ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                        )}
                        Refresh Models
                      </Button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[170px_1fr_auto] md:items-end">
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-mono-readout text-muted-foreground uppercase">
                          Sort By
                        </label>
                        <Select value={modelSort} onValueChange={(value) => setModelSort(value as NvidiaModelSort)}>
                          <SelectTrigger className="h-9 border-white/10 bg-black/40 font-mono text-[10px] text-slate-100">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="border-white/10 bg-[#020617] text-slate-100">
                            {(Object.keys(MODEL_SORT_LABELS) as NvidiaModelSort[]).map((sortKey) => (
                              <SelectItem key={sortKey} value={sortKey} className="font-mono text-[10px]">
                                {MODEL_SORT_LABELS[sortKey]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5 min-w-0">
                        <label className="text-[9px] font-mono-readout text-muted-foreground uppercase">
                          NVIDIA Model
                        </label>
                        <Select
                          value={tempNvidiaModel || undefined}
                          onValueChange={(value) => {
                            setTempNvidiaModel(value);
                            setNvidiaModelMessage(null);
                          }}
                          disabled={isLoadingNvidiaModels || selectableNvidiaModels.length === 0}
                        >
                          <SelectTrigger className="h-9 min-w-0 border-white/10 bg-black/40 font-mono text-[10px] text-primary">
                            <SelectValue placeholder={isLoadingNvidiaModels ? "Loading models..." : "Select model"} />
                          </SelectTrigger>
                          <SelectContent className="max-h-72 border-white/10 bg-[#020617] text-slate-100">
                            {selectableNvidiaModels.map((model) => (
                              <SelectItem key={model.id} value={model.id} className="font-mono text-[10px]">
                                {model.id} - {model.score}/100
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Button
                        type="button"
                        onClick={handleSaveNvidiaModel}
                        disabled={!selectedModelIsDirty || isSavingNvidiaModel}
                        className="h-9 shrink-0 bg-secondary text-secondary-foreground text-[10px] font-bold uppercase hover:bg-secondary/90"
                      >
                        {isSavingNvidiaModel ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
                        Use Model
                      </Button>
                    </div>

                    {selectedModelDetails && (
                      <div className="rounded border border-primary/10 bg-primary/5 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[10px] text-primary">
                              {selectedModelDetails.id}
                            </p>
                            <p className="mt-1 font-mono text-[8px] uppercase text-muted-foreground">
                              {selectedModelDetails.provider} / {selectedModelDetails.category}
                            </p>
                          </div>
                          <div className="shrink-0 rounded border border-secondary/20 bg-secondary/10 px-2 py-1 font-mono text-[9px] text-secondary">
                            Score {selectedModelDetails.score}/100
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {selectedModelDetails.capabilities.slice(0, 6).map((capability) => (
                            <span
                              key={capability}
                              className="rounded border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[8px] uppercase text-muted-foreground"
                            >
                              {capability}
                            </span>
                          ))}
                        </div>
                        <p className="mt-2 font-mono text-[8px] leading-relaxed text-muted-foreground">
                          {selectedModelDetails.rankNote}
                        </p>
                      </div>
                    )}

                    <p className={cn(
                      "font-mono text-[8px]",
                      nvidiaModelMessage?.includes("Failed") || nvidiaModelMessage?.includes("not set") || nvidiaModelMessage?.includes("only enabled")
                        ? "text-destructive"
                        : "text-muted-foreground"
                    )}>
                      {nvidiaModelMessage || "Model id is stored locally in .env.local as NVIDIA_MODEL."}
                    </p>
                  </div>
                  <div className="mt-4 border-t border-white/10 pt-4 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[10px] font-mono-readout text-muted-foreground uppercase">
                          System Instruction
                        </p>
                        <p className="mt-1 font-mono text-[8px] text-muted-foreground">
                          Replaces the active Neural Command instruction. Live status, tree, history, and directive context are appended automatically.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={loadSystemInstruction}
                        disabled={isLoadingSystemInstruction}
                        className="h-8 shrink-0 border-white/10 bg-transparent text-[10px] uppercase hover:bg-white/5"
                      >
                        {isLoadingSystemInstruction ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                        )}
                        Reload
                      </Button>
                    </div>
                    <Textarea
                      value={systemInstructionDraft}
                      onChange={(event) => {
                        setSystemInstructionDraft(event.target.value);
                        setSystemInstructionMessage(null);
                      }}
                      spellCheck={false}
                      className="min-h-[260px] resize-y border-white/10 bg-black/50 font-mono text-[10px] leading-relaxed text-slate-200 focus-visible:ring-primary"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className={cn(
                        "font-mono text-[8px]",
                        systemInstructionMessage?.includes("Failed") || systemInstructionMessage?.includes("required") || systemInstructionMessage?.includes("large")
                          ? "text-destructive"
                          : "text-muted-foreground"
                      )}>
                        {systemInstructionMessage || "Stored locally as NEXUS_SYSTEM_INSTRUCTION_B64 in .env.local."}
                      </p>
                      <div className="flex shrink-0 justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleResetSystemInstruction}
                          disabled={isSavingSystemInstruction || !defaultSystemInstruction}
                          className="h-8 border-white/10 bg-transparent text-[10px] uppercase hover:bg-white/5"
                        >
                          <Undo2 className="mr-2 h-3.5 w-3.5" />
                          Reset Default
                        </Button>
                        <Button
                          type="button"
                          onClick={handleSaveSystemInstruction}
                          disabled={!systemInstructionIsDirty || isSavingSystemInstruction || !systemInstructionDraft.trim()}
                          className="h-8 bg-primary text-primary-foreground text-[10px] font-bold uppercase hover:bg-primary/90"
                        >
                          {isSavingSystemInstruction ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
                          Save Instruction
                        </Button>
                      </div>
                    </div>
                  </div>
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
            <div className="w-6 h-6 rounded-full bg-primary/40 border border-primary/20 flex items-center justify-center text-[10px] font-bold">OP</div>
            <span className="font-mono-readout text-[10px]">Operator</span>
          </div>
        </div>
      </header>

      <div className="p-4 md:p-6 lg:p-8 max-w-[2200px] mx-auto pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-3 xl:col-span-3 2xl:col-span-3 space-y-6">
            <SystemHealth />
            <DashboardCard
              title="Turbo Sync"
              subtitle="Force Sensor Refresh"
              headerAction={
                isTurboSyncing ? (
                  <RefreshCcw className="w-4 h-4 text-primary animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 text-primary" />
                )
              }
            >
              <div className="flex flex-col gap-4">
                <p className="font-mono text-xs leading-relaxed text-muted-foreground">
                  {isTurboSyncing
                    ? "Pulling live Nexus packets..."
                    : "Force an immediate Nexus telemetry pull. Useful when the auto-pulse looks stale."}
                </p>
                <div className="grid grid-cols-3 gap-2 font-mono text-[10px] uppercase">
                  <span className="rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-center text-primary">
                    <span className="block text-[8px] text-primary/70">CPU</span>
                    <span className="font-bold">{cpuLoad}%</span>
                  </span>
                  <span className="rounded border border-secondary/30 bg-secondary/5 px-2 py-1.5 text-center text-secondary">
                    <span className="block text-[8px] text-secondary/70">RAM</span>
                    <span className="font-bold">{ramUsed}%</span>
                  </span>
                  <span className="rounded border border-white/10 bg-black/20 px-2 py-1.5 text-center text-foreground/80">
                    <span className="block text-[8px] text-muted-foreground">PID</span>
                    <span className="font-bold">{totalThreads}</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleTurboSync}
                  disabled={isTurboSyncing || state === "OFFLINE"}
                  className="flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-gradient-to-br from-primary/20 to-primary/5 px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-widest text-primary transition-all hover:border-primary/60 hover:from-primary/30 hover:to-primary/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-primary/30 disabled:hover:from-primary/20 disabled:hover:to-primary/5"
                >
                  {isTurboSyncing ? (
                    <>
                      <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                      <span>Syncing</span>
                    </>
                  ) : (
                    <>
                      <Zap className="h-3.5 w-3.5" />
                      <span>Trigger Sync</span>
                    </>
                  )}
                </button>
              </div>
            </DashboardCard>
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
                        <div className="flex items-center justify-between text-[10px] font-mono">
                            <span className="text-muted-foreground">Last Packet</span>
                            <span className="text-primary">{lastPacketAge === null ? "--" : `${lastPacketAge}s ago`}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono">
                            <span className="text-muted-foreground">Thread Map</span>
                            <span className="text-secondary">{totalThreads}</span>
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

          <div className="lg:col-span-6 xl:col-span-5 2xl:col-span-5 space-y-6">
            <NeuralCommand />
            <NeuralVisualizer />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <KnowledgeGraph />
                <NexusLogs />
            </div>
          </div>

          <div className="lg:col-span-3 xl:col-span-4 2xl:col-span-4 space-y-6 xl:grid xl:grid-cols-2 xl:gap-6 xl:space-y-0 xl:items-start">
            <AgentRoster />
            <SmartFallback />
            <div className="xl:col-span-2">
              <CouncilComms />
            </div>
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
            <span className="hidden sm:inline truncate max-w-[420px]" title={workingDirectory || "Nexus root"}>
              CWD: {workingDirectory ? workingDirectory.replace(/\\/g, "/").replace(/\/+$/, "") : "Nexus root"}
            </span>
            <span className="hidden sm:inline text-primary/60 font-bold">AI_OPERATOR_ACTIVE</span>
        </div>
        <div className="flex items-center gap-4 font-mono-readout text-[8px] text-muted-foreground">
            <span className="animate-pulse text-primary font-bold uppercase truncate max-w-[200px]">Signal: {uplinkLabel}</span>
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
