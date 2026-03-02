
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useUplink } from "@/hooks/use-uplink";
import { NexusClient, NexusEnvelope } from "@/lib/nexus/NexusClient";

export type ConnectionState = "OFFLINE" | "HANDSHAKE" | "SYNCING" | "LINKED" | "RE-SYNCING";

export interface NexusLog {
  timestamp: string;
  type: string;
  payload: any;
}

interface NexusContextType {
  state: ConnectionState;
  systemHealth: any | null;
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
  authorize: () => void;
  sendCommand: (cmd: string, payload: any) => Promise<any>;
  readFile: (path: string) => Promise<string | null>;
  writeFile: (path: string, content: string) => Promise<void>;
  killProcess: (pid: number) => Promise<void>;
  addManualLog: (type: string, payload: any) => void;
  clearLogs: () => void;
  updateUrl: (newUrl: string) => void;
  updateKey: (newKey: string) => void;
}

const NexusContext = createContext<NexusContextType | undefined>(undefined);

const FAILURE_THRESHOLD = 10; 

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
  
  const clientRef = useRef<NexusClient | null>(null);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedKey = localStorage.getItem('nexus_security_key');
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
    setNexusKey(newKey);
    localStorage.setItem('nexus_security_key', newKey);
  };

  const authorize = useCallback(() => {
    if (url) {
      window.open(url, "nexus_handshake", "width=600,height=600");
    }
  }, [url]);

  const addLog = useCallback((envelope: NexusEnvelope<any>) => {
    setNexusLogs(prev => {
      const newLog: NexusLog = {
        timestamp: envelope.header?.timestamp || new Date().toISOString(),
        type: envelope.header?.type || "GENERIC",
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
      const [health, graph, files, tree] = await Promise.allSettled([
        clientRef.current.fetchEnvelope<any>("/health"),
        clientRef.current.fetchEnvelope<any>("/graph"),
        clientRef.current.fetchEnvelope<any>("/filesystem"),
        clientRef.current.fetchEnvelope<any>("/filesystem/tree", { 
          method: 'POST', 
          body: { path: workingDirectory } // STICKY_SYNC
        })
      ]);

      let anySuccess = false;

      if (health.status === "fulfilled") {
        setSystemHealth(health.value.payload);
        setStatus(health.value.header?.status || "STABLE");
        addLog(health.value);
        anySuccess = true;
      }

      if (graph.status === "fulfilled") {
        setKnowledgeGraph(graph.value.payload);
        addLog(graph.value);
        anySuccess = true;
      }

      if (files.status === "fulfilled") {
        setFileChanges(prev => {
          const newFiles = files.value.payload?.files || [];
          const uniqueNewFiles = newFiles.filter((nf: any) => !prev.some(pf => pf.timestamp === nf.timestamp && pf.filename === nf.filename));
          return [...uniqueNewFiles, ...prev].slice(0, 10);
        });
        addLog(files.value);
        anySuccess = true;
      }

      if (tree.status === "fulfilled") {
        const response = tree.value;
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

    let endpoint = '/nexus/command';
    let bodyPayload = { cmd, ...payload };

    if (cmd === 'READ_FILE') {
      endpoint = '/read-file';
      bodyPayload = { path: payload.path };
    } else if (cmd === 'WRITE_FILE') {
      endpoint = '/write-file';
    } else if (cmd === 'SET_PATH') {
      endpoint = '/filesystem/tree';
      bodyPayload = { path: payload.path };
    }

    try {
      const result = await clientRef.current.sendCommand(endpoint, bodyPayload);
      if (cmd === 'SET_PATH') {
        // Immediate State Sync to prevent race conditions
        setWorkingDirectory(payload.path);
        const treeResult = await clientRef.current.fetchEnvelope<any>("/filesystem/tree", {
          method: 'POST',
          body: { path: payload.path }
        });
        const cleanTree = Array.isArray(treeResult)
          ? treeResult
          : (treeResult.payload?.tree || treeResult.payload || treeResult.tree || []);
        setFileTree(cleanTree);
      } else {
        fetchData();
      }
      return result;
    } catch (error: any) {
      addManualLog("ERROR", `Command Execution Fault: ${error.message}`);
      throw error;
    }
  }, [fetchData, addManualLog]);

  const readFile = useCallback(async (path: string): Promise<string | null> => {
    if (!clientRef.current || !path) return null;
    try {
      const response = await sendCommand("READ_FILE", { path });
      const content = response?.payload?.content ?? response?.content;
      const filepath = response?.payload?.filepath ?? response?.path ?? path;

      if (content !== undefined) {
        setFileContent({ path: filepath, content: content });
        addManualLog("FILESYSTEM", `Peek Protocol: Retrieval successful from ${path}`);
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
      addManualLog("FILESYSTEM", `Scribe Protocol: Written to ${path}`);
    } catch (e: any) {
      addManualLog("ERROR", `Scribe Failure: ${e.message}`);
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
      state, systemHealth, knowledgeGraph, fileChanges, fileTree, nexusLogs,
      lastUpdate, url, nexusKey, status, fileContent, consecutiveFailures, workingDirectory,
      setFileContent, authorize, sendCommand, readFile, writeFile, killProcess, addManualLog, clearLogs, updateUrl, updateKey
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
