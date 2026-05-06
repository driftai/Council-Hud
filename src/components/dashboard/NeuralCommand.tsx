
"use client";

import { useState, useRef, useEffect } from "react";
import { DashboardCard } from "./DashboardCard";
import { Terminal, Send, Loader2, Sparkles, AlertCircle, Brain, Command } from "lucide-react";
import { useNexus } from "@/providers/NexusProvider";
import { nexusCommand } from "@/ai/flows/nexus-commander";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

type ChatMessage = {
  role: 'user' | 'model';
  content: string;
  command?: string;
  timestamp: number;
};

type ReadFileSnapshot = {
  path: string;
  content: string;
};

type FileTreeNode = {
  name?: string;
  path?: string;
  type?: string;
  children?: FileTreeNode[];
};

function normalizePathSeparators(path: string) {
  return path.replace(/\\/g, "/");
}

function getFileName(path: string) {
  return normalizePathSeparators(path).split("/").filter(Boolean).pop() || path;
}

function stripFileContentWrapper(value: string) {
  const trimmed = value.trim();
  const tripleQuoted = trimmed.match(/^"""([\s\S]*)"""$/);
  if (tripleQuoted) return tripleQuoted[1].trim();
  return trimmed;
}

function wantsRedaction(directive: string) {
  const text = directive.toLowerCase();
  return /\b(redact|redacted|blur|blurr|mask|hide|censor|sanitize)\b/.test(text)
    || /\bbur\s+out\b/.test(text)
    || (/\b(important|importnat|sensitive|secret|private)\s+(info|information)\b/.test(text)
      && /\b(out|hide|blur|redact|mask|remove)\b/.test(text));
}

function wantsPlainOutput(directive: string) {
  const text = directive.toLowerCase();
  return /\b(unredacted|no redaction|without redaction|plain extract|raw extract|show the sensitive|show sensitive)\b/.test(text);
}

function shouldRedactForTurn(rootDirective: string, history: ChatMessage[]) {
  if (wantsPlainOutput(rootDirective)) return false;
  if (wantsRedaction(rootDirective)) return true;

  const recentUserText = history
    .filter((message) => message.role === "user")
    .slice(-4)
    .map((message) => message.content)
    .join("\n");
  const currentContinuesFileRequest = /\b(it|that|file|read|info|content|send|again|dont open|don't open)\b/i.test(rootDirective);
  return currentContinuesFileRequest && wantsRedaction(recentUserText) && !wantsPlainOutput(recentUserText);
}

function redactSensitiveContent(value: string) {
  return value
    .replace(/\bnvapi-[A-Za-z0-9_-]+/g, "[REDACTED_NVIDIA_API_KEY]")
    .replace(/(api\s*key\s*\d*\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(token\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(secret\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(password\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(codex\s+resume\s+)[A-Za-z0-9-]+/gi, "$1[REDACTED_SESSION]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[REDACTED_ID]")
    .replace(/\bC:[/\\]Users[/\\][^/\\\r\n]+/gi, "C:/Users/[REDACTED_USER]");
}

function parseMaybeJsonMessage(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  const attempts = [
    trimmed,
    trimmed.replace(/\\(?!["\\/bfnrtu])/g, "/"),
  ];

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      continue;
    }
  }

  return null;
}

function formatObjectValue(value: unknown): string {
  if (typeof value === "string") return normalizePathSeparators(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function humanizeObjectMessage(value: Record<string, unknown>) {
  if (typeof value.file_content === "string") {
    return `File content:\n\n${stripFileContentWrapper(value.file_content)}`;
  }

  if (typeof value.codeword === "string") {
    return `Codeword: ${stripFileContentWrapper(value.codeword)}`;
  }

  if (typeof value.error === "string") {
    return value.status ? `${value.error}\nStatus: ${formatObjectValue(value.status)}` : value.error;
  }

  if (typeof value.description === "string" || typeof value.visible === "boolean") {
    const description = typeof value.description === "string"
      ? value.description
      : value.visible
        ? "Yes, it is visible."
        : "No, it is not visible.";
    const path = typeof value.path === "string" ? `\nPath: ${normalizePathSeparators(value.path)}` : "";
    return `${description}${path}`;
  }

  if (typeof value.action === "string" && typeof value.file_path === "string") {
    return `Reading ${getFileName(value.file_path)}...\nPath: ${normalizePathSeparators(value.file_path)}`;
  }

  return Object.entries(value)
    .map(([key, entry]) => `${key.replace(/_/g, " ")}: ${formatObjectValue(entry)}`)
    .join("\n");
}

function humanizeModelMessage(message: string, shouldRedact = false) {
  const parsed = parseMaybeJsonMessage(message);
  let display: string;
  if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
    display = humanizeObjectMessage(parsed as Record<string, unknown>);
  } else if (Array.isArray(parsed)) {
    display = parsed.map((entry) => formatObjectValue(entry)).join("\n");
  } else {
    display = normalizePathSeparators(message);
  }

  return shouldRedact ? redactSensitiveContent(display) : display;
}

function wantsInspectorOpen(directive: string, payload: Record<string, any>, shouldRedact = false) {
  const text = directive.toLowerCase();
  if (/\b(don't|dont|do not|without)\s+open/.test(text)) return false;
  if (shouldRedact) return false;
  const asksForContent = /\b(read|tell me|what.*say|content|contents|code\s*word|codeword)\b/.test(text);
  const directiveWantsOpen =
    /\b(open|pull up)\b/.test(text) ||
    (!asksForContent && /\b(show|view|display)\b/.test(text));

  const payloadSignals = [
    payload.openInspector,
    payload.open_inspector,
    payload.viewer,
    payload.mode,
    payload.action,
  ].map((value) => String(value ?? "").toLowerCase());

  return (
    payload.openInspector === true ||
    payload.open_inspector === true ||
    payloadSignals.some((value) => /\b(open|show|view|display|inspector)\b/.test(value)) ||
    directiveWantsOpen
  );
}

function isCodewordDirective(directive: string) {
  return /\bcode\s*word\b|\bcodeword\b/i.test(directive);
}

function extractCodeword(content: string) {
  const cleaned = stripFileContentWrapper(content);
  const labeled = cleaned.match(/code\s*word\s*[:=-]\s*["']?(.+?)["']?\s*$/im);
  if (labeled) return stripFileContentWrapper(labeled[1]).replace(/^["']|["']$/g, "");

  const firstMeaningfulLine = cleaned.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return (firstMeaningfulLine || cleaned || "(empty file)").replace(/^["']|["']$/g, "");
}

function shouldAnswerDirectlyFromRead(directive: string, shouldRedact = false) {
  return shouldRedact
    || /\b(read|tell me|what.*say|what is|what's|content|contents|code\s*word|codeword)\b/i.test(directive);
}

function wantsMultipleFileRead(directive: string) {
  const text = directive.toLowerCase();
  return /\b(both|all|each|files|and also|also|then|test.*info|info.*test)\b/.test(text)
    || (/\band\b/.test(text) && /\b(file|files|txt|text)\b/.test(text));
}

function isFileReadDirective(directive: string) {
  return /\b(read|what.*in|what.*says?|tell me|content|contents|files?)\b/i.test(directive);
}

function flattenFileTree(nodes: unknown): FileTreeNode[] {
  if (!Array.isArray(nodes)) return [];

  const flattened: FileTreeNode[] = [];
  const visit = (node: FileTreeNode) => {
    flattened.push(node);
    if (Array.isArray(node.children)) {
      node.children.forEach(visit);
    }
  };

  nodes.forEach((node) => {
    if (node && typeof node === "object") visit(node as FileTreeNode);
  });

  return flattened;
}

function isFolderNode(node: FileTreeNode) {
  return node.type === "folder" || node.type === "directory";
}

function isFileNode(node: FileTreeNode) {
  return node.type === "file";
}

function fileNameMatchesDirective(name: string, directive: string) {
  const normalizedName = name.toLowerCase();
  const normalizedDirective = directive.toLowerCase();
  const stem = normalizedName.replace(/\.[^.]+$/, "");

  return normalizedDirective.includes(normalizedName)
    || normalizedDirective.includes(stem)
    || (stem === "info" && /\binfo\b/.test(normalizedDirective))
    || (stem === "test" && /\btest\b/.test(normalizedDirective));
}

function getFilesUnderFolder(folder: FileTreeNode) {
  const children = Array.isArray(folder.children) ? folder.children : [];
  return children
    .filter((child) => isFileNode(child) && typeof child.path === "string")
    .map((child) => normalizePathSeparators(child.path!));
}

function inferReadPathsFromContext(directive: string, history: ChatMessage[], fileTree: unknown) {
  if (!isFileReadDirective(directive)) return [];

  const nodes = flattenFileTree(fileTree);
  const fileNodes = nodes.filter((node) => isFileNode(node) && typeof node.path === "string");
  const recentText = history
    .slice(-8)
    .map((message) => message.content)
    .join("\n");
  const combinedText = `${directive}\n${recentText}`;
  const inferred = new Set<string>();

  for (const file of fileNodes) {
    if (typeof file.name === "string" && fileNameMatchesDirective(file.name, directive)) {
      inferred.add(normalizePathSeparators(file.path!));
    }
  }

  const mentionsNotes = /\bnotes?\b/i.test(combinedText);
  const asksForFolderFiles = wantsMultipleFileRead(directive) || /\bfiles?\b/i.test(directive);
  if (mentionsNotes && asksForFolderFiles) {
    const notesFolder = nodes.find((node) => isFolderNode(node) && String(node.name || "").toLowerCase() === "notes");
    if (notesFolder) {
      getFilesUnderFolder(notesFolder).forEach((path) => inferred.add(path));
    }
    for (const file of fileNodes) {
      const path = normalizePathSeparators(file.path!);
      if (/(^|\/)notes\//i.test(path)) inferred.add(path);
    }
    if (inferred.size === 0 && fileNodes.length > 0 && fileNodes.length <= 5) {
      fileNodes
        .filter((file) => /\.txt$/i.test(String(file.name || file.path || "")))
        .forEach((file) => inferred.add(normalizePathSeparators(file.path!)));
    }
  }

  const explicitTxtNames = Array.from(directive.matchAll(/\b[\w.-]+\.txt\b/gi)).map((match) => match[0].toLowerCase());
  if (explicitTxtNames.length > 0) {
    for (const file of fileNodes) {
      const fileName = String(file.name || "").toLowerCase();
      if (explicitTxtNames.includes(fileName)) inferred.add(normalizePathSeparators(file.path!));
    }
  }

  return Array.from(inferred).slice(0, 5);
}

function getReadFilePaths(payload: Record<string, any>) {
  const candidates = [
    payload.path,
    payload.file_path,
    payload.filePath,
    ...(Array.isArray(payload.paths) ? payload.paths : []),
    ...(Array.isArray(payload.files) ? payload.files : []),
  ];

  const seen = new Set<string>();
  return candidates
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => normalizePathSeparators(value.trim()))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function buildFileReadResponse(directive: string, path: string, content: string, openedInspector: boolean, shouldRedact = false) {
  const fileName = getFileName(path);
  const displayPath = normalizePathSeparators(path);
  const cleaned = stripFileContentWrapper(content);

  if (openedInspector && !shouldRedact) {
    return `Opened ${fileName} in Remote_Inspector.\nPath: ${displayPath}`;
  }

  if (shouldRedact) {
    return `I read ${fileName}. Redacted important information:\n\n${redactSensitiveContent(cleaned) || "(empty file)"}`;
  }

  if (isCodewordDirective(directive)) {
    return `The codeword in ${fileName} is: ${extractCodeword(content)}.`;
  }

  return `I read ${fileName}. It says:\n\n${cleaned || "(empty file)"}`;
}

function isEmptyBridgeResponse(message: string) {
  return /Bridge Offline:\s*Empty response from Neural Bridge/i.test(message);
}

export function NeuralCommand() {
  const nexus = useNexus();
  const { state, knowledgeGraph, fileTree, systemHealth, url, addManualLog, fileContent, workingDirectory } = nexus;
  
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastAgentReadFile, setLastAgentReadFile] = useState<ReadFileSnapshot | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  /**
   * Atomic Neural Handshake V110
   * Uses a local 'history' variable to ensure the AI receives 
   * retrieved results in the SAME operational flow.
   */
  const processAiTurn = async (
    input: string,
    historySeed: ChatMessage[],
    isSilent: boolean = false,
    rootDirective: string = input,
    readFileOverride: ReadFileSnapshot | null = null,
    readDepth: number = 0,
    redactionOverride?: boolean
  ) => {
    let localHistory = [...historySeed];
    
    if (!isSilent) {
      const userMsg: ChatMessage = { role: 'user', content: input, timestamp: Date.now() };
      localHistory.push(userMsg);
      setMessages([...localHistory]);
    }

    setIsLoading(true);
    if (!isSilent) addManualLog("NEURAL", `Analyzing directive: "${input}"`);
    const shouldRedactTurn = redactionOverride ?? shouldRedactForTurn(rootDirective, localHistory);

    try {
      const conversationHistory = localHistory.slice(-15).map(m => ({
        role: m.role,
        content: m.content
      }));
      const contextReadFile = readFileOverride || lastAgentReadFile || fileContent || undefined;

      let result = await nexusCommand({
        prompt: input,
        history: conversationHistory,
        context: {
          processes: knowledgeGraph?.nodes || [],
          fileTree: fileTree || [],
          systemHealth: systemHealth || {},
          currentUrl: url,
          workingDirectory: workingDirectory || "C:/",
          lastReadFile: contextReadFile ? { path: contextReadFile.path, content: contextReadFile.content } : undefined
        }
      });
      const inferredReadPaths = inferReadPathsFromContext(rootDirective, localHistory, fileTree);

      if (isEmptyBridgeResponse(result.message) && inferredReadPaths.length > 0) {
        result = {
          thought: "Local fallback recovered file-read intent from visible file tree context.",
          command: "READ_FILE",
          payload: inferredReadPaths.length > 1 ? { paths: inferredReadPaths } : { path: inferredReadPaths[0] },
          message: inferredReadPaths.length > 1
            ? `Reading ${inferredReadPaths.length} files from local context.`
            : `Reading ${getFileName(inferredReadPaths[0])} from local context.`,
        };
      }

      const modelMsg: ChatMessage = {
        role: 'model',
        content: humanizeModelMessage(result.message, shouldRedactTurn),
        command: result.command !== "NONE" ? result.command : undefined,
        timestamp: Date.now()
      };
      
      localHistory = [...localHistory, modelMsg];
      setMessages([...localHistory]);

      if (result.thought) addManualLog("NEURAL", result.thought);
      const allowSilentFollowupRead = result.command === "READ_FILE"
        && wantsMultipleFileRead(rootDirective)
        && readDepth < 4;
      if (isSilent && result.command !== "NONE" && !allowSilentFollowupRead) {
        addManualLog("SECURITY", `Suppressed ${result.command} from file-derived AI context`);
        return;
      }

      // --- SYNCHRONOUS HANDSHAKE LOOP ---
      if (result.command === "READ_FILE") {
        const readPathSet = new Set(getReadFilePaths(result.payload || {}));
        if (wantsMultipleFileRead(rootDirective)) {
          inferredReadPaths.forEach((path) => readPathSet.add(path));
        }
        const readPaths = Array.from(readPathSet);
        if (readPaths.length === 0) return;

        const openInspector = readPaths.length === 1 && wantsInspectorOpen(rootDirective, result.payload, shouldRedactTurn);
        const readSnapshots: ReadFileSnapshot[] = [];
        try {
          for (const readPath of readPaths.slice(0, 5)) {
            addManualLog("COMMAND", `Executing READ_FILE: ${readPath}`);
            const content = await nexus.readFile(readPath, { openInspector });
            if (content === null) continue;

            const readSnapshot = { path: readPath, content };
            readSnapshots.push(readSnapshot);
            setLastAgentReadFile(readSnapshot);
            const readResponse: ChatMessage = {
              role: 'model',
              content: buildFileReadResponse(rootDirective, readPath, content, openInspector, shouldRedactTurn),
              timestamp: Date.now()
            };
            localHistory = [...localHistory, readResponse];
            setMessages([...localHistory]);
          }

          const lastReadSnapshot = readSnapshots[readSnapshots.length - 1];
          if (!lastReadSnapshot) return;

          const shouldContinueForMoreFiles = wantsMultipleFileRead(rootDirective)
            && readPaths.length === 1
            && readDepth < 4;
          if (openInspector || (shouldAnswerDirectlyFromRead(rootDirective, shouldRedactTurn) && !shouldContinueForMoreFiles)) {
            return;
          }

          const feedbackContent = readSnapshots
            .map((snapshot) => `FILE: ${snapshot.path}\nCONTENT:\n"""\n${snapshot.content}\n"""`)
            .join("\n\n");

          // RECURSIVE TURN: Content injected immediately into localHistory accumulator
          await processAiTurn(
            `SYSTEM_FEEDBACK: File retrieval completed.
ORIGINAL_DIRECTIVE:
"""
${rootDirective}
"""
${feedbackContent}
Answer the original directive using the retrieved file content. If the original directive asks for another file that has not been retrieved yet, request READ_FILE for that file. Do not open the file inspector unless the original directive explicitly asked to open it.`,
            localHistory,
            true,
            rootDirective,
            lastReadSnapshot,
            readDepth + 1,
            shouldRedactTurn
          );
        } catch (readError: any) {
          addManualLog("ERROR", `READ_FILE FAILED: ${readError.message}`);
          await processAiTurn(
            `SYSTEM_FEEDBACK: READ_FILE_FAILED error=${readError.message}
ORIGINAL_DIRECTIVE:
"""
${rootDirective}
"""
Tell the user the file could not be read and include the failure reason.`,
            localHistory,
            true,
            rootDirective,
            readFileOverride,
            readDepth + 1,
            shouldRedactTurn
          );
        }
      } else if (result.command !== "NONE") {
        addManualLog("COMMAND", `Executing ${result.command}`);
        switch (result.command) {
          case "KILL_PROCESS":
            if (result.payload.pid) await nexus.sendCommand("KILL_PROCESS", { pid: result.payload.pid });
            break;
          case "SET_PATH":
            if (result.payload.path) await nexus.sendCommand("SET_PATH", { path: result.payload.path });
            break;
          case "WRITE_FILE":
            if (result.payload.path) await nexus.writeFile(result.payload.path, result.payload.content || "");
            break;
        }
      }

    } catch (error: any) {
      const errorMsg = `Neural Bridge Fault: ${error.message || "Network Timeout"}`;
      setMessages(prev => [...prev, { role: 'model', content: errorMsg, timestamp: Date.now() }]);
      addManualLog("ERROR", errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt || isLoading) return;
    const currentInput = prompt;
    setPrompt("");
    processAiTurn(currentInput, messages, false, currentInput);
  };

  return (
    <DashboardCard 
      title="Neural Command" 
      subtitle="AI-Driven Orchestration"
      headerAction={<Sparkles className={cn("w-4 h-4", isLoading ? "text-primary animate-spin" : "text-secondary")} />}
      className="border-primary/20 bg-primary/5"
    >
      <div className="flex flex-col gap-4 h-[350px]">
        <ScrollArea className="flex-1 rounded-lg bg-black/40 border border-white/5 p-4 relative" viewportRef={scrollRef}>
          <div className="absolute top-2 right-2 p-2 opacity-5 pointer-events-none"><Brain className="w-12 h-12" /></div>
          <div className="space-y-4">
            {messages.length === 0 && !isLoading && (
              <div className="text-muted-foreground/40 flex flex-col items-center justify-center h-48 gap-2">
                <Terminal className="w-8 h-8" />
                <p className="uppercase tracking-widest text-[9px]">Neural Link Stable. Awaiting Directive...</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={cn("flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300", msg.role === 'user' ? "items-end" : "items-start")}>
                <div className="flex items-center gap-1.5 px-2">
                  <span className={cn("text-[8px] font-bold uppercase", msg.role === 'model' ? "text-primary" : "text-secondary")}>
                    {msg.role === 'model' ? "Nexus_Op" : "User"}
                  </span>
                  {msg.command && (
                    <div className="flex items-center gap-1 px-1 py-0.5 rounded bg-primary/20 border border-primary/30 text-[7px] text-primary">
                      <Command className="w-2 h-2" />{msg.command}
                    </div>
                  )}
                </div>
                <div className={cn("max-w-[90%] whitespace-pre-wrap break-words p-2 rounded-lg font-mono text-[10px] leading-relaxed", msg.role === 'user' ? "bg-secondary/10 border border-secondary/30 text-secondary shadow-[0_0_14px_rgba(34,197,94,0.08)]" : "bg-primary/5 border border-primary/10 text-foreground/90 italic")}>
                  {msg.content.startsWith('SYSTEM_FEEDBACK') ? 'Processing neural data...' : msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex flex-col items-start gap-1 animate-pulse">
                <span className="text-[8px] font-bold text-primary uppercase px-2">Nexus_Op reasoning...</span>
                <div className="bg-primary/5 border border-primary/10 rounded-lg p-2 w-24">
                  <div className="flex gap-1">
                    <div className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-1 h-1 bg-primary rounded-full animate-bounce" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        <form onSubmit={handleSubmit} className="relative">
          <Input 
            value={prompt ?? ""} 
            onChange={(e) => setPrompt(e.target.value)} 
            placeholder="Input directive..." 
            className="pr-12 bg-black/60 border-primary/20 focus-visible:ring-primary text-xs h-10 font-mono" 
            disabled={isLoading || state === "OFFLINE"} 
          />
          <Button type="submit" size="icon" variant="ghost" className="absolute right-1 top-1 h-8 w-8 text-primary hover:bg-primary/10" disabled={isLoading || !prompt || state === "OFFLINE"}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
        {state === "OFFLINE" && <div className="flex items-center gap-2 text-[9px] text-destructive font-mono animate-pulse"><AlertCircle className="w-3 h-3" /><span>HARDWARE_LINK_OFFLINE</span></div>}
      </div>
    </DashboardCard>
  );
}
