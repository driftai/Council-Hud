"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Eraser,
  MessageSquare,
  Radio,
  RefreshCcw,
  RotateCcw,
  Send,
  Users,
} from "lucide-react";

type CouncilSession = {
  name: string;
  agent: string;
  role: string;
  mode: "operator" | "live" | "viewer" | "bridge";
  connectedAt: number;
  topics: string[];
};

type CouncilMessage = {
  id: string;
  timestamp: string;
  sender: string;
  to: string;
  content: string;
  topic: string;
  kind: string;
  priority: boolean;
  pending?: boolean;
};

type CouncilStatus = {
  ok: boolean;
  sessions: CouncilSession[];
  uptime?: number;
  error?: string | null;
};

type Scope = "topic" | "dm" | "broadcast";

const KIND_OPTIONS = ["chat", "status", "task", "ack", "error"];
const SESSION_STORAGE_KEY = "council-hud-session-name";
const SCOPE_STORAGE_KEY = "council-hud-scope";
const TOPIC_STORAGE_KEY = "council-hud-topic";
const TARGET_STORAGE_KEY = "council-hud-target";
const CLEAR_PREFIX = "council-hud-clear-before";

function formatMessageTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getSenderClass(sender: string) {
  const normalized = sender.toLowerCase().replace(/-bridge$/, "");
  if (normalized === "operator") return "text-primary";
  if (normalized === "viewer-b" || normalized === "viewer-a" || normalized === "viewer-c") return "text-fuchsia-300";
  if (["agent-a", "agent-b", "agent-c", "agent-d", "agent-e"].includes(normalized)) return "text-secondary";
  return "text-muted-foreground";
}

function cleanSessionName(value: string, fallback = "operator") {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
  return cleaned || fallback;
}

function cleanTopicName(value: string, fallback = "council") {
  const cleaned = value.trim().replace(/^#/, "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
  return cleaned || fallback;
}

function buildClearKey(scope: Scope, sessionName: string, topic: string, target: string) {
  const channel = scope === "topic" ? cleanTopicName(topic) : scope === "dm" ? cleanSessionName(target, "target") : "broadcast";
  return `${CLEAR_PREFIX}:${sessionName}:${scope}:${channel}`;
}

function sameMessage(a: CouncilMessage, b: CouncilMessage) {
  if (a.sender !== b.sender || a.content !== b.content || a.kind !== b.kind) return false;
  const left = Date.parse(a.timestamp);
  const right = Date.parse(b.timestamp);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return Math.abs(left - right) < 120000;
}

function messageMatchesScope(message: CouncilMessage, scope: Scope, sessionName: string, topic: string, target: string) {
  if (message.pending) return true;
  if (scope === "topic") {
    return message.topic === cleanTopicName(topic) && (!message.to || message.to === "*");
  }
  if (scope === "dm") {
    const cleanTarget = cleanSessionName(target, "target");
    return (message.sender === sessionName && message.to === cleanTarget)
      || (message.sender === cleanTarget && message.to === sessionName)
      || (message.sender === cleanTarget && message.to === "operator")
      || (message.sender === "operator" && message.to === cleanTarget);
  }
  // Broadcast = any message addressed to "*" regardless of topic. The hub requires a topic for
  // fanout, so broadcasts carry topic="council" by default; show them here too.
  return message.to === "*";
}

export function CouncilComms() {
  const [status, setStatus] = useState<CouncilStatus>({ ok: false, sessions: [] });
  const [messages, setMessages] = useState<CouncilMessage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<CouncilMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sessionName, setSessionName] = useState("operator");
  const [sessionDraft, setSessionDraft] = useState("operator");
  const [scope, setScope] = useState<Scope>("topic");
  const [target, setTarget] = useState("agent-e-bridge");
  const [topic, setTopic] = useState("council");
  const [kind, setKind] = useState("chat");
  const [clearBefore, setClearBefore] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeClearKey = useMemo(
    () => buildClearKey(scope, sessionName, topic, target),
    [scope, sessionName, topic, target]
  );

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/council/status", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    setStatus({
      ok: Boolean(data.ok),
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      uptime: Number(data.uptime || 0),
      error: data.error || null,
    });
    if (!response.ok) throw new Error(data.error || "Council status unavailable.");
  }, []);

  const loadMessages = useCallback(async () => {
    const response = await fetch("/api/council/messages?limit=160", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    const nextMessages = Array.isArray(data.messages) ? data.messages : [];
    setMessages(nextMessages);
    setPendingMessages((current) => current.filter((pending) => !nextMessages.some((message: CouncilMessage) => sameMessage(pending, message))));
    if (!response.ok && response.status !== 206) throw new Error(data.error || "Council message tail unavailable.");
  }, []);

  const refreshCouncil = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      await Promise.all([loadStatus(), loadMessages()]);
    } catch (refreshError: any) {
      setError(refreshError?.message || "Council bridge refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }, [loadMessages, loadStatus]);

  useEffect(() => {
    const storedSession = cleanSessionName(window.localStorage.getItem(SESSION_STORAGE_KEY) || "operator");
    const storedScope = window.localStorage.getItem(SCOPE_STORAGE_KEY);
    const storedTopic = cleanTopicName(window.localStorage.getItem(TOPIC_STORAGE_KEY) || "council");
    const storedTarget = cleanSessionName(window.localStorage.getItem(TARGET_STORAGE_KEY) || "agent-e-bridge", "agent-e-bridge");

    setSessionName(storedSession);
    setSessionDraft(storedSession);
    setScope(storedScope === "dm" || storedScope === "broadcast" ? storedScope : "topic");
    setTopic(storedTopic);
    setTarget(storedTarget);
  }, []);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(activeClearKey) || 0);
    setClearBefore(Number.isFinite(stored) ? stored : 0);
  }, [activeClearKey]);

  useEffect(() => {
    window.localStorage.setItem(SCOPE_STORAGE_KEY, scope);
    window.localStorage.setItem(TOPIC_STORAGE_KEY, cleanTopicName(topic));
    window.localStorage.setItem(TARGET_STORAGE_KEY, cleanSessionName(target, "agent-e-bridge"));
  }, [scope, target, topic]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        await Promise.all([loadStatus(), loadMessages()]);
        if (!cancelled) setError(null);
      } catch (tickError: any) {
        if (!cancelled) setError(tickError?.message || "Council bridge unavailable.");
      }
    };

    tick();
    const messageInterval = setInterval(tick, 2200);
    return () => {
      cancelled = true;
      clearInterval(messageInterval);
    };
  }, [loadMessages, loadStatus]);

  const targetOptions = useMemo(() => {
    const seen = new Set<string>();
    return status.sessions
      .filter((session) => session.name && session.name !== sessionName)
      .filter((session) => {
        if (seen.has(session.name)) return false;
        seen.add(session.name);
        return true;
      })
      .map((session) => ({
        value: session.name,
        label: session.name === session.agent ? session.agent : `${session.agent} (${session.name})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sessionName, status.sessions]);

  const scopeLabel = scope === "topic" ? `#${cleanTopicName(topic)}` : scope === "dm" ? `DM: ${target}` : "Broadcast";
  const allMessages = useMemo(() => {
    const merged = [...messages, ...pendingMessages]
      .filter((message) => messageMatchesScope(message, scope, sessionName, topic, target))
      .filter((message) => Date.parse(message.timestamp) > clearBefore);
    return merged.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }, [clearBefore, messages, pendingMessages, scope, sessionName, target, topic]);
  const lastPacket = allMessages.at(-1);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [allMessages.length]);

  const applySessionName = () => {
    const cleaned = cleanSessionName(sessionDraft);
    setSessionName(cleaned);
    setSessionDraft(cleaned);
    window.localStorage.setItem(SESSION_STORAGE_KEY, cleaned);
  };

  const postCouncilMessage = async (content: string, messageKind = kind) => {
    const outgoing: CouncilMessage = {
      id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      sender: sessionName,
      to: scope === "dm" ? target : "*",
      content,
      topic: scope === "topic" ? cleanTopicName(topic) : "",
      kind: messageKind,
      priority: false,
      pending: true,
    };

    setPendingMessages((current) => [...current, outgoing].slice(-20));
    const response = await fetch("/api/council/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sessionName,
        to: target,
        topic: cleanTopicName(topic),
        scope,
        kind: messageKind,
        content,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      setPendingMessages((current) => current.filter((message) => message.id !== outgoing.id));
      throw new Error(data.error || "Council send failed.");
    }
    setPendingMessages((current) => current.map((message) => (
      message.id === outgoing.id ? { ...message, pending: false } : message
    )));
    setTimeout(() => {
      loadMessages().catch(() => undefined);
    }, 450);
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSending) return;

    setIsSending(true);
    setError(null);
    try {
      await postCouncilMessage(content);
      setDraft("");
    } catch (sendError: any) {
      setError(sendError?.message || "Council send failed.");
    } finally {
      setIsSending(false);
    }
  };

  const handleClearView = () => {
    const next = Date.now();
    window.localStorage.setItem(activeClearKey, String(next));
    setClearBefore(next);
    setPendingMessages([]);
  };

  const [copiedTranscript, setCopiedTranscript] = useState(false);

  const buildCommsTranscript = () => {
    if (allMessages.length === 0) return "";
    const lines: string[] = [
      `Council Comms — ${scopeLabel}`,
      `Session: ${sessionName}`,
      `Exported: ${new Date().toISOString()}`,
      `Messages: ${allMessages.length}`,
      "",
    ];
    for (const message of allMessages) {
      const stamp = new Date(message.timestamp).toISOString();
      const route = message.to && message.to !== "*" ? ` -> ${message.to}` : "";
      const topicTag = message.topic ? ` #${message.topic}` : "";
      const kindTag = message.kind && message.kind !== "chat" ? ` [${message.kind}]` : "";
      const pendingTag = message.pending ? " (pending)" : "";
      lines.push(`--- ${message.sender}${route}${topicTag}${kindTag}${pendingTag} @ ${stamp} ---`);
      lines.push(message.content || "(empty message)");
      lines.push("");
    }
    return lines.join("\n");
  };

  const handleCopyComms = async () => {
    const transcript = buildCommsTranscript();
    if (!transcript) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(transcript);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = transcript;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 1500);
    } catch (copyError: any) {
      setError(copyError?.message || "Copy failed.");
    }
  };

  const handleNewSession = async () => {
    if (isSending) return;
    const confirmed = window.confirm(`Send /new to ${scopeLabel} and clear this HUD conversation view?`);
    if (!confirmed) return;

    setIsSending(true);
    setError(null);
    try {
      await postCouncilMessage("/new", "chat");
      handleClearView();
    } catch (newSessionError: any) {
      setError(newSessionError?.message || "Council /new failed.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <DashboardCard
      title="Council Comms"
      subtitle="IPC Hub Mirror"
      headerAction={
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase">
          <Users className="h-3.5 w-3.5 text-primary" />
          <span className={status.ok ? "text-secondary" : "text-destructive"}>
            {status.ok ? `${status.sessions.length} linked` : "offline"}
          </span>
        </div>
      }
    >
      <div className="flex h-[580px] flex-col gap-3">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            value={sessionDraft}
            onChange={(event) => setSessionDraft(event.target.value)}
            onBlur={applySessionName}
            className="h-8 rounded border border-white/10 bg-black/40 px-2 font-mono text-[10px] text-primary outline-none focus:border-primary/50"
            aria-label="Council session name"
          />
          <Button
            type="button"
            variant="outline"
            onClick={applySessionName}
            className="h-8 border-white/10 bg-transparent px-2 font-mono text-[9px] uppercase hover:bg-white/5"
          >
            Name
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded border border-white/10 bg-black/20 p-1">
          {(["topic", "dm", "broadcast"] as Scope[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setScope(option)}
              className={cn(
                "h-7 rounded px-1 font-mono text-[9px] uppercase transition-colors",
                scope === option ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-slate-100"
              )}
            >
              {option === "topic" ? "Topic" : option === "dm" ? "DM" : "All"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {scope === "topic" ? (
            <input
              value={topic}
              onChange={(event) => setTopic(cleanTopicName(event.target.value))}
              className="h-8 rounded border border-white/10 bg-black/40 px-2 font-mono text-[10px] text-slate-100 outline-none focus:border-primary/50"
              aria-label="Council topic"
            />
          ) : (
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={scope === "broadcast"}
              className="h-8 rounded border border-white/10 bg-black/40 px-2 font-mono text-[10px] uppercase text-slate-100 outline-none focus:border-primary/50 disabled:opacity-50"
            >
              {targetOptions.length === 0 && <option value={target}>{target}</option>}
              {targetOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="h-8 rounded border border-white/10 bg-black/40 px-2 font-mono text-[10px] uppercase text-slate-100 outline-none focus:border-primary/50"
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-black/20 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-[10px] uppercase text-primary">
              {sessionName}{" -> "}{scopeLabel}
            </p>
            <p className="truncate font-mono text-[8px] text-muted-foreground">
              {error || status.error || (lastPacket ? `Last packet: ${lastPacket.sender} / ${formatMessageTime(lastPacket.timestamp)}` : "Awaiting council packets.")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              onClick={refreshCouncil}
              disabled={isRefreshing}
              className="h-8 w-8 border-white/10 bg-transparent p-0 hover:bg-white/5"
              title="Refresh council bridge"
            >
              <RefreshCcw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCopyComms}
              disabled={allMessages.length === 0}
              className="h-8 w-8 border-white/10 bg-transparent p-0 hover:bg-white/5 disabled:opacity-40"
              title={allMessages.length === 0 ? "No messages to copy" : `Copy ${allMessages.length} message${allMessages.length === 1 ? "" : "s"} from this view`}
            >
              {copiedTranscript ? <Check className="h-3.5 w-3.5 text-secondary" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClearView}
              className="h-8 w-8 border-white/10 bg-transparent p-0 hover:bg-white/5"
              title="Clear local view"
            >
              <Eraser className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleNewSession}
              disabled={isSending}
              className="h-8 w-8 border-white/10 bg-transparent p-0 hover:bg-white/5"
              title="Send /new and clear view"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1 rounded border border-white/10 bg-black/30 p-3" viewportRef={scrollRef}>
          <div className="space-y-3 pr-2">
            {allMessages.length === 0 ? (
              <div className="flex items-center gap-2 rounded border border-white/10 bg-black/20 p-3 font-mono text-[10px] text-muted-foreground">
                <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
                Awaiting council packets.
              </div>
            ) : (
              allMessages.map((message) => (
                <div key={message.id} className={cn("rounded border p-2", message.pending ? "border-primary/20 bg-primary/5" : "border-white/10 bg-white/[0.03]")}>
                  <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[8px] uppercase">
                    <span className={cn("truncate font-bold", getSenderClass(message.sender))}>
                      {message.sender}
                    </span>
                    <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                      {message.pending && <CheckCircle2 className="h-3 w-3 text-primary" />}
                      {message.kind !== "chat" && (
                        <span className="rounded border border-primary/20 px-1 text-primary">{message.kind}</span>
                      )}
                      {message.to && message.to !== "*" && (
                        <span className="rounded border border-fuchsia-300/20 px-1 text-fuchsia-300">dm</span>
                      )}
                      <span>{formatMessageTime(message.timestamp)}</span>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-slate-200">
                    {message.content || "(empty message)"}
                  </p>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <form onSubmit={handleSend} className="flex gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={scope === "dm" ? `DM ${target}...` : scope === "broadcast" ? "Broadcast..." : `Send to #${cleanTopicName(topic)}...`}
            className="min-h-16 resize-none border-white/10 bg-black/40 font-mono text-xs text-slate-100 focus-visible:ring-primary"
          />
          <div className="flex w-11 shrink-0 flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => postCouncilMessage("ping", "heartbeat").catch((pingError: any) => setError(pingError?.message || "Council ping failed."))}
              disabled={isSending}
              className="h-8 w-11 border-white/10 bg-transparent p-0 hover:bg-white/5"
              title="Ping active council scope"
            >
              <Radio className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="submit"
              disabled={!draft.trim() || isSending}
              className="min-h-0 flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              title="Send council message"
            >
              {isSending ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </form>

        <div className="grid grid-cols-3 gap-2 font-mono text-[8px] uppercase">
          <div className="rounded border border-white/10 bg-black/20 px-2 py-1 text-muted-foreground">
            <MessageSquare className="mr-1 inline h-3 w-3 text-primary" />
            {allMessages.length} view
          </div>
          <div className="rounded border border-white/10 bg-black/20 px-2 py-1 text-muted-foreground">
            {pendingMessages.length} pending
          </div>
          <div className={cn("rounded border border-white/10 bg-black/20 px-2 py-1", status.ok ? "text-secondary" : "text-destructive")}>
            {status.ok ? "hub linked" : "hub down"}
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}
