
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

function humanizeModelMessage(message: string, directive = "") {
  const parsed = parseMaybeJsonMessage(message);
  let display: string;
  if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
    display = humanizeObjectMessage(parsed as Record<string, unknown>);
  } else if (Array.isArray(parsed)) {
    display = parsed.map((entry) => formatObjectValue(entry)).join("\n");
  } else {
    display = normalizePathSeparators(message);
  }

  return wantsRedaction(directive) ? redactSensitiveContent(display) : display;
}

function wantsInspectorOpen(directive: string, payload: Record<string, any>) {
  const text = directive.toLowerCase();
  if (/\b(don't|dont|do not|without)\s+open/.test(text)) return false;
  if (wantsRedaction(directive)) return false;
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

function shouldAnswerDirectlyFromRead(directive: string) {
  return wantsRedaction(directive)
    || /\b(read|tell me|what.*say|what is|what's|content|contents|code\s*word|codeword)\b/i.test(directive);
}

function buildFileReadResponse(directive: string, path: string, content: string, openedInspector: boolean) {
  const fileName = getFileName(path);
  const displayPath = normalizePathSeparators(path);
  const cleaned = stripFileContentWrapper(content);
  const shouldRedact = wantsRedaction(directive);

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
    readFileOverride: ReadFileSnapshot | null = null
  ) => {
    let localHistory = [...historySeed];
    
    if (!isSilent) {
      const userMsg: ChatMessage = { role: 'user', content: input, timestamp: Date.now() };
      localHistory.push(userMsg);
      setMessages([...localHistory]);
    }

    setIsLoading(true);
    if (!isSilent) addManualLog("NEURAL", `Analyzing directive: "${input}"`);

    try {
      const conversationHistory = localHistory.slice(-15).map(m => ({
        role: m.role,
        content: m.content
      }));
      const contextReadFile = readFileOverride || lastAgentReadFile || fileContent || undefined;

      const result = await nexusCommand({
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

      const modelMsg: ChatMessage = {
        role: 'model',
        content: humanizeModelMessage(result.message, rootDirective),
        command: result.command !== "NONE" ? result.command : undefined,
        timestamp: Date.now()
      };
      
      localHistory = [...localHistory, modelMsg];
      setMessages([...localHistory]);

      if (result.thought) addManualLog("NEURAL", result.thought);
      if (isSilent && result.command !== "NONE") {
        addManualLog("SECURITY", `Suppressed ${result.command} from file-derived AI context`);
        return;
      }

      // --- SYNCHRONOUS HANDSHAKE LOOP ---
      if (result.command === "READ_FILE" && result.payload?.path) {
        const readPath = String(result.payload.path);
        const openInspector = wantsInspectorOpen(rootDirective, result.payload);
        addManualLog("COMMAND", `Executing READ_FILE: ${readPath}`);
        try {
          const content = await nexus.readFile(readPath, { openInspector });
          if (content !== null) {
            const readSnapshot = { path: readPath, content };
            setLastAgentReadFile(readSnapshot);
            const readResponse: ChatMessage = {
              role: 'model',
              content: buildFileReadResponse(rootDirective, readPath, content, openInspector),
              timestamp: Date.now()
            };
            localHistory = [...localHistory, readResponse];
            setMessages([...localHistory]);

            if (openInspector || shouldAnswerDirectlyFromRead(rootDirective)) {
              return;
            }

            // RECURSIVE TURN: Content injected immediately into localHistory accumulator
            await processAiTurn(
              `SYSTEM_FEEDBACK: File retrieved from ${readPath}.
ORIGINAL_DIRECTIVE:
"""
${rootDirective}
"""
CONTENT:
"""
${content}
"""
Answer the original directive using this file content. Do not open the file inspector. Do not request another file read unless a different file is required.`,
              localHistory,
              true,
              rootDirective,
              readSnapshot
            );
          }
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
            readFileOverride
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
