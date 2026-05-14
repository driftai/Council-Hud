
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useUplink } from "@/hooks/use-uplink";
import { NexusClient, NexusEnvelope } from "@/lib/nexus/NexusClient";
import { classifyNexusPacket } from "@/lib/nexus/logging";

export type ConnectionState = "OFFLINE" | "HANDSHAKE" | "SYNCING" | "LINKED" | "RE-SYNCING";

export interface NexusLog {
  timestamp: string;
  type: string;
  payload: any;
}

export interface SystemHealthAverage {
  samples: number;
  windowSeconds: number;
  cpuLoad: number | null;
  ramUsed: number | null;
  cpuTemp: number | null;
}

type ReadFileOptions = {
  openInspector?: boolean;
};

interface NexusContextType {
  state: ConnectionState;
  systemHealth: any | null;
  systemHealthAverage: SystemHealthAverage | null;
  knowledgeGraph: any | null;
  fileChanges: any[];
  fileTree: any | null;
  nexusLogs: NexusLog[];
  lastUpdate: number;
  url: string;
  nexusKey: string;
  status: string | null;
  fileContent: { path: string; content: string } | null;
  consecutiveFailures: number;
  workingDirectory: string;
  setFileContent: (val: { path: string; content: string } | null) => void;
  refreshTelemetry: () => Promise<void>;
  authorize: () => void;
  sendCommand: (cmd: string, payload: any) => Promise<any>;
  readFile: (path: string, options?: ReadFileOptions) => Promise<string | null>;
  writeFile: (path: string, content: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  renameFile: (fromPath: string, toPath: string) => Promise<void>;
  killProcess: (pid: number) => Promise<void>;
  addManualLog: (type: string, payload: any) => void;
  clearLogs: () => void;
  updateUrl: (newUrl: string) => void;
  updateKey: (newKey: string) => void;
}

const NexusContext = createContext<NexusContextType | undefined>(undefined);

const FAILURE_THRESHOLD = 10; 
const SECURITY_STORAGE_KEY = 'nexus_security_key';

function readStoredNexusKey() {
  const sessionKey = sessionStorage.getItem(SECURITY_STORAGE_KEY);
  if (sessionKey) return sessionKey;

  const legacyKey = localStorage.getItem(SECURITY_STORAGE_KEY);
  if (legacyKey) {
    sessionStorage.setItem(SECURITY_STORAGE_KEY, legacyKey);
    localStorage.removeItem(SECURITY_STORAGE_KEY);
  }
  return legacyKey || "";
}

export function NexusProvider({ children }: { children: React.ReactNode }) {
  const { url, updateUrl, isReady } = useUplink();
  const [nexusKey, setNexusKey] = useState<string>("");
  const [state, setState] = useState<ConnectionState>("OFFLINE");
  const [systemHealth, setSystemHealth] = useState<any | null>(null);
  const [knowledgeGraph, setKnowledgeGraph] = useState<any | null>(null);
  const [fileChanges, setFileChanges] = useState<any[]>([]);
  const [fileTree, setFileTree] = useState<any | null>(null);
  const [nexusLogs, setNexusLogs] = useState<NexusLog[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const [status, setStatus] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<{ path: string; content: string } | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [workingDirectory, setWorkingDirectory] = useState<string>("");
  const [systemHealthAverage, setSystemHealthAverage] = useState<SystemHealthAverage | null>(null);

  const clientRef = useRef<NexusClient | null>(null);
  const isFetchingRef = useRef(false);
  const healthHistoryRef = useRef<Array<{ ts: number; cpuLoad: number | null; ramUsed: number | null; cpuTemp: number | null }>>([]);

  const HEALTH_WINDOW_MS = 60_000;
  const HEALTH_SAMPLE_LIMIT = 60;

  const recordHealthSample = useCallback((sample: any) => {
    if (!sample || typeof sample !== "object") return;
    const toNum = (value: unknown) => {
      if (value === null || value === undefined || value === "") return null;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };
    const entry = {
      ts: Date.now(),
      cpuLoad: toNum(sample.cpu_load),
      ramUsed: toNum(sample.ram_used),
      cpuTemp: toNum(sample.cpu_temp),
    };
    const history = healthHistoryRef.current;
    history.push(entry);
    const cutoff = entry.ts - HEALTH_WINDOW_MS;
    while (history.length > 0 && history[0].ts < cutoff) history.shift();
    if (history.length > HEALTH_SAMPLE_LIMIT) history.splice(0, history.length - HEALTH_SAMPLE_LIMIT);

    const avg = (key: "cpuLoad" | "ramUsed" | "cpuTemp") => {
      let total = 0;
      let count = 0;
      for (const item of history) {
        const value = item[key];
        if (value !== null) {
          total += value;
          count += 1;
        }
      }
      return count > 0 ? Number((total / count).toFixed(1)) : null;
    };

    setSystemHealthAverage({
      samples: history.length,
      windowSeconds: HEALTH_WINDOW_MS / 1000,
      cpuLoad: avg("cpuLoad"),
      ramUsed: avg("ramUsed"),
      cpuTemp: avg("cpuTemp"),
    });
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedKey = readStoredNexusKey();
      if (savedKey) setNexusKey(savedKey);
    }
  }, []);

  useEffect(() => {
    if (url) {
      clientRef.current = new NexusClient(url);
      setState("SYNCING");
      setConsecutiveFailures(0);
    }
  }, [url, nexusKey]);

  const updateKey = (newKey: string) => {
    const trimmedKey = newKey.trim();
    setNexusKey(trimmedKey);
    sessionStorage.setItem(SECURITY_STORAGE_KEY, trimmedKey);
    localStorage.removeItem(SECURITY_STORAGE_KEY);
  };

  const authorize = useCallback(() => {
    if (url) {
      const opened = window.open(url, "nexus_handshake", "width=600,height=600,noopener,noreferrer");
      if (opened) opened.opener = null;
    }
  }, [url]);

  const addLog = useCallback((envelope: NexusEnvelope<any>, fallbackType?: string) => {
    setNexusLogs(prev => {
      const newLog: NexusLog = {
        timestamp: envelope.header?.timestamp || new Date().toISOString(),
        type: classifyNexusPacket(envelope.payload, envelope.header?.type, fallbackType),
        payload: envelope.payload
      };
      if (prev.length > 0 && prev[0].timestamp === newLog.timestamp && prev[0].type === newLog.type) {
        return prev;
      }
      return [newLog, ...prev].slice(0, 50);
    });
  }, []);

  const addManualLog = useCallback((type: string, payload: any) => {
    setNexusLogs(prev => {
      const newLog: NexusLog = {
        timestamp: new Date().toISOString(),
        type,
        payload
      };
      return [newLog, ...prev].slice(0, 50);
    });
  }, []);

  const clearLogs = useCallback(() => {
    setNexusLogs([]);
  }, []);

  const fetchData = useCallback(async () => {
    if (!isReady || !clientRef.current || !url || isFetchingRef.current) return;
    
    isFetchingRef.current = true;

    try {
      // PROMPT: Always include workingDirectory to prevent "NO PATH" warnings
      const [health, graph, tree] = await Promise.allSettled([
        clientRef.current.fetchEnvelope<any>("/health"),
        clientRef.current.fetchEnvelope<any>("/graph"),
        clientRef.current.fetchEnvelope<any>("/filesystem/tree", { 
          method: 'POST', 
          body: { path: workingDirectory } // STICKY_SYNC
        })
      ]);

      let anySuccess = false;

      if (health.status === "fulfilled") {
        setSystemHealth(health.value.payload);
        setStatus(health.value.header?.status || "STABLE");
        recordHealthSample(health.value.payload);
        addLog(health.value, "HARDWARE_PULSE");
        anySuccess = true;
      }

      if (graph.status === "fulfilled") {
        setKnowledgeGraph(graph.value.payload);
        addLog(graph.value, "PROCESS_GRAPH");
        anySuccess = true;
      }

      if (tree.status === "fulfilled") {
        const response = tree.value as any;
        const cleanTree = Array.isArray(response)
          ? response
          : (response.payload?.tree || response.payload || response.tree || []);
        setFileTree(cleanTree);
        anySuccess = true;
      }

      if (anySuccess) {
        setConsecutiveFailures(0);
        setLastUpdate(Date.now());
        setState("LINKED");
      } else {
        throw new Error("Telemetry Stream Interrupted");
      }

    } catch (e: any) {
      setConsecutiveFailures(prev => {
        const next = prev + 1;
        if (next >= FAILURE_THRESHOLD) {
          setState("OFFLINE");
        } else {
          setState("RE-SYNCING");
        }
        return next;
      });
      if (e.message.includes("Security Alert")) {
        addManualLog("ERROR", e.message);
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, [isReady, addLog, url, workingDirectory, addManualLog]);

  const sendCommand = useCallback(async (cmd: string, payload: any) => {
    if (!clientRef.current) throw new Error("Nexus Bridge not initialized");
    
    if (payload.path) {
      payload.path = decodeURIComponent(payload.path).replace(/\\/g, '/').replace(/\/+$/, '');
    }
    if (payload.fromPath) {
      payload.fromPath = decodeURIComponent(payload.fromPath).replace(/\\/g, '/').replace(/\/+$/, '');
    }
    if (payload.toPath) {
      payload.toPath = decodeURIComponent(payload.toPath).replace(/\\/g, '/').replace(/\/+$/, '');
    }

    let endpoint = '/nexus/command';
    let bodyPayload = { cmd, ...payload };

    if (cmd === 'READ_FILE') {
      endpoint = '/read-file';
      bodyPayload = { path: payload.path };
    } else if (cmd === 'WRITE_FILE') {
      endpoint = '/write-file';
    } else if (cmd === 'DELETE_FILE') {
      endpoint = '/delete-file';
      bodyPayload = { path: payload.path };
    } else if (cmd === 'RENAME_FILE') {
      endpoint = '/rename-file';
      bodyPayload = { fromPath: payload.fromPath, toPath: payload.toPath };
    } else if (cmd === 'SET_PATH') {
      endpoint = '/filesystem/tree';
      bodyPayload = { path: payload.path, reset: payload.reset, depth: payload.depth };
    }

    try {
      const result = await clientRef.current.sendCommand(endpoint, bodyPayload);
      if (cmd === 'SET_PATH') {
        setWorkingDirectory(payload.reset ? "" : (payload.path || ""));
        const treeResult = result as any;
        const cleanTree = Array.isArray(treeResult)
          ? treeResult
          : (treeResult.payload?.tree || treeResult.payload || treeResult.tree || []);
        setFileTree(cleanTree);
        addManualLog("FILESYSTEM_TREE", {
          path: payload.reset ? "Nexus Root" : (payload.path || "Nexus Root"),
          roots: Array.isArray(cleanTree) ? cleanTree.length : 0,
        });
      } else {
        fetchData();
      }
      return result;
    } catch (error: any) {
      addManualLog("ERROR", `Command Execution Fault: ${error.message}`);
      throw error;
    }
  }, [fetchData, addManualLog]);

  const readFile = useCallback(async (path: string, options: ReadFileOptions = {}): Promise<string | null> => {
    if (!clientRef.current || !path) return null;
    try {
      const response = await sendCommand("READ_FILE", { path });
      const content = response?.payload?.content ?? response?.content;
      const filepath = response?.payload?.filepath ?? response?.path ?? path;

      if (content !== undefined) {
        if (options.openInspector !== false) {
          setFileContent({ path: filepath, content: content });
        }
        addManualLog("FILE_READ", {
          path: filepath,
          bytes: String(content).length,
          viewer: options.openInspector === false ? "agent_context" : "remote_inspector",
        });
        return content;
      }
      throw new Error(response?.error || "Empty response from node.");
    } catch (e: any) {
      addManualLog("ERROR", `Peek Protocol Failed: ${e.message}`);
      throw e;
    }
  }, [sendCommand, addManualLog]);

  const writeFile = useCallback(async (path: string, content: string) => {
    if (!clientRef.current || !path) return;
    try {
      await sendCommand("WRITE_FILE", { path, content });
      setFileContent(prev => prev?.path === path ? { path: prev.path, content } : prev);
      addManualLog("FILE_WRITE", { path, bytes: content.length });
    } catch (e: any) {
      addManualLog("ERROR", `Scribe Failure: ${e.message}`);
      throw e;
    }
  }, [sendCommand, addManualLog]);

  const deleteFile = useCallback(async (path: string) => {
    if (!clientRef.current || !path) return;
    try {
      await sendCommand("DELETE_FILE", { path });
      setFileContent(prev => prev?.path === path ? null : prev);
      addManualLog("FILE_DELETE", { path });
    } catch (e: any) {
      addManualLog("ERROR", `Delete Failure: ${e.message}`);
      throw e;
    }
  }, [sendCommand, addManualLog]);

  const renameFile = useCallback(async (fromPath: string, toPath: string) => {
    if (!clientRef.current || !fromPath || !toPath) return;
    try {
      await sendCommand("RENAME_FILE", { fromPath, toPath });
      setFileContent(prev => prev?.path === fromPath ? { path: toPath, content: prev.content } : prev);
      addManualLog("FILE_RENAME", { fromPath, toPath });
    } catch (e: any) {
      addManualLog("ERROR", `Rename Failure: ${e.message}`);
      throw e;
    }
  }, [sendCommand, addManualLog]);

  const killProcess = useCallback(async (pid: number) => {
    await sendCommand("KILL_PROCESS", { pid });
  }, [sendCommand]);

  useEffect(() => {
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <NexusContext.Provider value={{
      state, systemHealth, systemHealthAverage, knowledgeGraph, fileChanges, fileTree, nexusLogs,
      lastUpdate, url, nexusKey, status, fileContent, consecutiveFailures, workingDirectory,
      setFileContent, refreshTelemetry: fetchData, authorize, sendCommand, readFile, writeFile, deleteFile, renameFile, killProcess, addManualLog, clearLogs, updateUrl, updateKey
    }}>
      {children}
    </NexusContext.Provider>
  );
}

export function useNexus() {
  const context = useContext(NexusContext);
  if (context === undefined) {
    throw new Error("useNexus must be used within a NexusProvider");
  }
  return context;
}
