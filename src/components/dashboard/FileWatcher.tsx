"use client";

import { useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { ArrowUp, FileJson, Folder, FolderOpen, FolderSync, ChevronRight, ChevronDown, HardDrive, Home, Settings2, RefreshCw, Eye } from "lucide-react";
import { useNexus } from "@/providers/NexusProvider";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface FileNode {
  name: string;
  path: string;
  type: 'folder' | 'directory' | 'file';
  size?: number;
  modified?: string;
  children?: FileNode[];
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function getParentPath(value: string) {
  const normalized = normalizePath(value);
  if (!normalized || /^[a-zA-Z]:\/?$/.test(normalized)) return "";

  const parts = normalized.split("/");
  parts.pop();

  const parent = parts.join("/");
  if (/^[a-zA-Z]:$/.test(parent)) return `${parent}/`;
  return parent || "/";
}

function formatPathLabel(value: string) {
  if (!value) return "Nexus Root";
  const normalized = normalizePath(value);
  return normalized.split("/").filter(Boolean).slice(-3).join(" / ") || normalized;
}

function getVisibleRootPath(fileTree: unknown) {
  if (!Array.isArray(fileTree) || fileTree.length === 0) return "";
  const firstNode = fileTree[0] as Partial<FileNode>;
  return typeof firstNode.path === "string" ? getParentPath(firstNode.path) : "";
}

function FileTreeItem({
  node,
  depth = 0,
  onNavigate,
}: {
  node: FileNode;
  depth?: number;
  onNavigate: (path: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { readFile } = useNexus();
  const isFolder = node.type === 'folder' || node.type === 'directory';
  const hasChildren = isFolder && Array.isArray(node.children) && node.children.length > 0;

  const handleClick = () => {
    if (isFolder) {
      if (hasChildren) setIsOpen(!isOpen);
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
        onDoubleClick={() => {
          if (isFolder) onNavigate(node.path);
        }}
      >
        {isFolder ? (
          <>
            {hasChildren ? (
              isOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />
            ) : (
              <div className="w-3" />
            )}
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
        {isFolder && (
          <button
            type="button"
            title="Open folder as root"
            aria-label={`Open ${node.name} as root`}
            className="h-6 w-6 shrink-0 rounded border border-white/10 bg-black/30 text-primary opacity-0 transition-all hover:bg-primary/10 hover:border-primary/30 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-primary group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onNavigate(node.path);
            }}
          >
            <FolderOpen className="mx-auto h-3.5 w-3.5" />
          </button>
        )}
      </div>
      
      {isFolder && isOpen && hasChildren && (
        <div className="border-l border-white/5 ml-[18px]">
          {node.children!.map((child: any) => (
            <FileTreeItem key={child.path || child.name} node={child} depth={depth + 1} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileWatcher() {
  const { state, fileTree, sendCommand, workingDirectory } = useNexus();
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const connected = state === "LINKED";
  const visibleRootPath = getVisibleRootPath(fileTree);
  const activeDirectory = workingDirectory || visibleRootPath;
  const parentPath = getParentPath(activeDirectory);
  const pathLabel = workingDirectory
    ? formatPathLabel(workingDirectory)
    : visibleRootPath
      ? `Nexus Root / ${formatPathLabel(visibleRootPath)}`
      : "Nexus Root";

  const navigateToPath = async (path: string, reset = false) => {
    if (!connected || isNavigating) return;
    setIsNavigating(true);
    try {
      await sendCommand("SET_PATH", { path, reset });
    } catch (e) {
      console.error("Navigation Failed:", e);
    } finally {
      setIsNavigating(false);
    }
  };

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
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-white/5 bg-black/20 p-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Go to parent folder"
            aria-label="Go to parent folder"
            disabled={!connected || !parentPath || isNavigating}
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
            onClick={() => navigateToPath(parentPath)}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Go to mirror root"
            aria-label="Go to mirror root"
            disabled={!connected || isNavigating}
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
            onClick={() => navigateToPath("", true)}
          >
            <Home className="h-3.5 w-3.5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              {pathLabel}
            </p>
          </div>
          {isNavigating && <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />}
        </div>

        {isConfiguring && (
          <div className="mb-4 p-3 rounded-lg bg-black/40 border border-primary/20 space-y-3 animate-in slide-in-from-top-2">
            <div className="space-y-1">
              <p className="text-[9px] font-mono-readout text-primary uppercase">Remote Target Path</p>
              <Input 
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="C:/Path/To/Workspace"
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
                <FileTreeItem key={rootNode.path || rootNode.name} node={rootNode} onNavigate={navigateToPath} />
              )) : null}
            </div>
          </ScrollArea>
        )}
      </div>
    </DashboardCard>
  );
}
