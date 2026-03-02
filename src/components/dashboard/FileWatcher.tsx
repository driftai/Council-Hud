"use client";

import { useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { FolderSync, FileJson, Folder, ChevronRight, ChevronDown, HardDrive, Settings2, RefreshCw, Eye } from "lucide-react";
import { useNexus } from "@/providers/NexusProvider";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface FileNode {
  name: string;
  path: string;
  type: 'folder' | 'file';
  size?: number;
  modified?: string;
  children?: FileNode[];
}

function FileTreeItem({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const { readFile } = useNexus();
  const isFolder = node.type === 'folder' || node.type === 'directory';

  const handleClick = () => {
    if (isFolder) {
      setIsOpen(!isOpen);
    } else {
      readFile(node.path);
    }
  };

  return (
    <div className="select-none">
      <div 
        className={cn(
          "flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-white/5 transition-colors group",
          isOpen && isFolder && "bg-white/[0.02]"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
      >
        {isFolder ? (
          <>
            {isOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            <Folder className={cn("w-3.5 h-3.5", isOpen ? "text-primary" : "text-primary/60")} />
          </>
        ) : (
          <>
            <div className="w-3" />
            <FileJson className="w-3.5 h-3.5 text-muted-foreground group-hover:text-secondary transition-colors" />
          </>
        )}
        <span className={cn(
          "font-mono text-[10px] truncate flex-1",
          isFolder ? "text-foreground font-semibold" : "text-muted-foreground"
        )}>
          {node.name}
        </span>
        {!isFolder && (
          <Eye className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 text-primary transition-opacity" />
        )}
      </div>
      
      {isFolder && isOpen && node.children && (
        <div className="border-l border-white/5 ml-[18px]">
          {node.children.map((child: any) => (
            <FileTreeItem key={child.path || child.name} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileWatcher() {
  const { state, fileTree, sendCommand } = useNexus();
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);

  const connected = state === "LINKED";

  const handleSyncPath = async () => {
    if (!newPath) return;
    setIsSyncing(true);
    try {
      await sendCommand("SET_PATH", { path: newPath });
      setIsConfiguring(false);
    } catch (e) {
      console.error("Path Sync Failed:", e);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <DashboardCard 
      title="Recursive Mirror" 
      subtitle="Shadow File Indexer" 
      headerAction={
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsConfiguring(!isConfiguring)}
            className={cn("p-1 rounded hover:bg-white/5 transition-colors", isConfiguring ? "text-primary" : "text-muted-foreground")}
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <FolderSync className={cn("w-4 h-4", connected ? "text-primary animate-spin-slow" : "text-muted-foreground")} />
        </div>
      }
    >
      <div className="h-[300px] flex flex-col">
        {isConfiguring && (
          <div className="mb-4 p-3 rounded-lg bg-black/40 border border-primary/20 space-y-3 animate-in slide-in-from-top-2">
            <div className="space-y-1">
              <p className="text-[9px] font-mono-readout text-primary uppercase">Remote Target Path</p>
              <Input 
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="C:\Users\alvin\..."
                className="h-8 bg-black/60 border-white/10 text-[10px] font-mono text-primary"
              />
            </div>
            <Button 
              onClick={handleSyncPath} 
              disabled={isSyncing}
              className="w-full h-7 bg-primary text-primary-foreground text-[10px] font-bold uppercase"
            >
              {isSyncing ? <RefreshCw className="w-3 h-3 animate-spin mr-2" /> : "Deploy Directives"}
            </Button>
          </div>
        )}

        {!connected || !fileTree || (Array.isArray(fileTree) && fileTree.length === 0) ? (
          <div className="flex-1 flex flex-col items-center justify-center border border-white/5 rounded-lg bg-black/20 text-center p-4">
            <HardDrive className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest leading-relaxed">
              {connected ? "Awaiting Recursive Sync..." : "Indexer Offline"}
            </p>
            {connected && !fileTree && (
              <p className="mt-2 text-[8px] text-primary/50 font-mono animate-pulse">VERIFYING_UNC_BRIDGE...</p>
            )}
          </div>
        ) : (
          <ScrollArea className="flex-1 -mx-4">
            <div className="py-2">
              {Array.isArray(fileTree) ? fileTree.map((rootNode: FileNode) => (
                <FileTreeItem key={rootNode.path || rootNode.name} node={rootNode} />
              )) : null}
            </div>
          </ScrollArea>
        )}
      </div>
    </DashboardCard>
  );
}
