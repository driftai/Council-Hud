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
  Maximize2,
  MessageSquare,
  Minimize2,
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
const SHOW_ACKS_STORAGE_KEY = "council-hud-show-acks";
const BRIDGE_STALE_MS = 3 * 60 * 1000;

function formatAgeShort(deltaMs: number) {
  if (deltaMs < 0) return "now";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function formatMessageTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type AgentIdentity = {
  defaultSender: string;
  defaultDmTarget: string;
  agents: Record<string, { role: string; mode: "operator" | "live" | "viewer" | "bridge"; sessionUrl?: string }>;
  agentBridges: Record<string, string>;
};

// Parse `@<name>` mentions from a message. Returns:
//   - `null` if no mention → use existing scope/target
//   - `{ broadcast: true }` if `@all` / `@allAgents` / `@everyone` (case-insensitive)
//   - `{ broadcast: false, agent: name, bridge: target }` for `@<agent>`
//
// The mention has to be at the start of the message (after optional whitespace) to count
// as a routing override — `@` mid-sentence is just a mention, not a redirect.
type MentionRoute =
  | null
  | { broadcast: true }
  | { broadcast: false; agent: string; bridge: string };

function parseMention(content: string, identity: AgentIdentity | null): MentionRoute {
  if (!identity) return null;
  const match = content.trimStart().match(/^@([A-Za-z][A-Za-z0-9_-]{1,30})\b/);
  if (!match) return null;
  const raw = match[1].toLowerCase();
  if (raw === "all" || raw === "allagents" || raw === "everyone") {
    return { broadcast: true };
  }
  const agents = identity.agents || {};
  const matchedAgent = Object.keys(agents).find((name) => name.toLowerCase() === raw);
  if (!matchedAgent) return null;
  const bridge = identity.agentBridges?.[matchedAgent] || matchedAgent + "-bridge";
  return { broadcast: false, agent: matchedAgent, bridge };
}

const MODE_COLOR_CLASS: Record<string, string> = {
  operator: "text-primary",
  live: "text-secondary",
  viewer: "text-fuchsia-300",
  bridge: "text-muted-foreground",
};

function senderClass(sender: string, identity: AgentIdentity | null, sessionsByAgent: Map<string, "operator" | "live" | "viewer" | "bridge">): string {
  const normalized = sender.toLowerCase().replace(/-bridge$/, "");
  // First try the live session table — most authoritative.
  const sessionMode = sessionsByAgent.get(normalized);
  if (sessionMode) return MODE_COLOR_CLASS[sessionMode] || "text-muted-foreground";
  // Fall back to identity config (covers agents that aren't currently linked).
  const profile = identity?.agents?.[normalized];
  if (profile) return MODE_COLOR_CLASS[profile.mode] || "text-muted-foreground";
  return "text-muted-foreground";
}

function cleanSessionName(value: string, fallback: string) {
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
    // Match messages between the user's session and the chosen DM target either direction.
    return (message.sender === sessionName && message.to === cleanTarget)
      || (message.sender === cleanTarget && message.to === sessionName);
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
  const [identity, setIdentity] = useState<AgentIdentity | null>(null);
  const [sessionName, setSessionName] = useState("operator");
  const [sessionDraft, setSessionDraft] = useState("operator");
  const [scope, setScope] = useState<Scope>("topic");
  const [target, setTarget] = useState("live-agent-bridge");
  const [topic, setTopic] = useState("council");
  const [kind, setKind] = useState("chat");
  const [clearBefore, setClearBefore] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAcks, setShowAcks] = useState(false);
  const [bridgeClockTick, setBridgeClockTick] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded]);

  useEffect(() => {
    const interval = setInterval(() => setBridgeClockTick((value) => value + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(SHOW_ACKS_STORAGE_KEY);
    if (stored === "1") setShowAcks(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SHOW_ACKS_STORAGE_KEY, showAcks ? "1" : "0");
  }, [showAcks]);

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

  // Fetch identity defaults (default sender, default DM target, agent mode lookup) from the
  // server. Falls back to placeholder strings if the endpoint isn't reachable. Real names live
  // in council.config.local.json (gitignored).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/council/identity", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!cancelled && data?.ok && data.identity) {
          const next = data.identity as AgentIdentity;
          setIdentity(next);
          // Hydrate session/target from localStorage if present, else from identity defaults.
          const storedSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
          const storedTarget = window.localStorage.getItem(TARGET_STORAGE_KEY);
          const storedScope = window.localStorage.getItem(SCOPE_STORAGE_KEY);
          const storedTopic = window.localStorage.getItem(TOPIC_STORAGE_KEY);
          const sessionFallback = next.defaultSender;
          const targetFallback = next.defaultDmTarget;
          const sessionValue = cleanSessionName(storedSession || sessionFallback, sessionFallback);
          const targetValue = cleanSessionName(storedTarget || targetFallback, targetFallback);
          setSessionName(sessionValue);
          setSessionDraft(sessionValue);
          setTarget(targetValue);
          setScope(storedScope === "dm" || storedScope === "broadcast" ? storedScope : "topic");
          setTopic(cleanTopicName(storedTopic || "council"));
        }
      } catch {
        /* swallow — fall back to whatever defaults we already have */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(activeClearKey) || 0);
    setClearBefore(Number.isFinite(stored) ? stored : 0);
  }, [activeClearKey]);

  useEffect(() => {
    if (!identity) return;
    window.localStorage.setItem(SCOPE_STORAGE_KEY, scope);
    window.localStorage.setItem(TOPIC_STORAGE_KEY, cleanTopicName(topic));
    window.localStorage.setItem(TARGET_STORAGE_KEY, cleanSessionName(target, identity.defaultDmTarget));
  }, [scope, target, topic, identity]);

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
  // Build a quick agent → mode lookup so message rendering can color sender names without
  // hardcoding identity. Live sessions win; identity config covers offline agents.
  const sessionsByAgent = useMemo(() => {
    const map = new Map<string, "operator" | "live" | "viewer" | "bridge">();
    for (const session of status.sessions) {
      if (session.agent) map.set(session.agent.toLowerCase(), session.mode);
    }
    return map;
  }, [status.sessions]);

  const allMessages = useMemo(() => {
    const merged = [...messages, ...pendingMessages]
      .filter((message) => messageMatchesScope(message, scope, sessionName, topic, target))
      .filter((message) => Date.parse(message.timestamp) > clearBefore)
      .filter((message) => showAcks || message.kind !== "ack");
    return merged.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }, [clearBefore, messages, pendingMessages, scope, sessionName, target, topic, showAcks]);
  const lastPacket = allMessages.at(-1);

  // Per-bridge delivery health: track the latest ACK timestamp from each *-bridge sender,
  // and surface its age. Bridges run their own poll loops outside the HUD; this lets the
  // operator see at a glance which bridges are flowing and which are lagging behind a broadcast.
  const bridgeStatus = useMemo(() => {
    const latest = new Map<string, number>();
    for (const message of messages) {
      if (message.kind !== "ack") continue;
      const senderName = message.sender || "";
      if (!senderName.toLowerCase().endsWith("-bridge")) continue;
      const ts = Date.parse(message.timestamp);
      if (!Number.isFinite(ts)) continue;
      const previous = latest.get(senderName) || 0;
      if (ts > previous) latest.set(senderName, ts);
    }
    return Array.from(latest.entries())
      .map(([name, ts]) => ({ name, ts }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [messages]);
  // Count hidden ACKs so the toggle hint is informative.
  const hiddenAckCount = useMemo(() => {
    if (showAcks) return 0;
    return messages.filter((message) => (
      message.kind === "ack"
      && messageMatchesScope(message, scope, sessionName, topic, target)
      && Date.parse(message.timestamp) > clearBefore
    )).length;
  }, [clearBefore, messages, scope, sessionName, target, topic, showAcks]);
  // Re-snapshot Date.now() each time the 5s clock tick fires so the bridge age pills refresh.
  const nowForBridgeAges = useMemo(() => Date.now(), [bridgeClockTick]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [allMessages.length]);

  const applySessionName = () => {
    const cleaned = cleanSessionName(sessionDraft, identity?.defaultSender || "operator");
    setSessionName(cleaned);
    setSessionDraft(cleaned);
    window.localStorage.setItem(SESSION_STORAGE_KEY, cleaned);
  };

  const postCouncilMessage = async (content: string, messageKind = kind) => {
    // @mention routing override: `@<agent>` at the start of the message forces a DM to
    // that agent's bridge (bypassing topic delegation). `@all` / `@allAgents` /
    // `@everyone` forces a broadcast to the council topic, hitting every agent that
    // listens on it. The mention text itself is left in the content so receivers see who
    // was addressed.
    const mention = parseMention(content, identity);
    const effectiveScope: Scope = mention?.broadcast ? "topic"
      : mention ? "dm"
      : scope;
    const effectiveTarget = mention && !mention.broadcast ? mention.bridge : target;
    const effectiveTopic = mention?.broadcast ? "council" : (scope === "topic" ? cleanTopicName(topic) : "");

    const outgoing: CouncilMessage = {
      id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      sender: sessionName,
      to: effectiveScope === "dm" ? effectiveTarget : "*",
      content,
      topic: effectiveScope === "topic" ? effectiveTopic : "",
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
        to: effectiveTarget,
        topic: effectiveTopic,
        scope: effectiveScope,
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
    <>
      {isExpanded && (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm"
          onClick={() => setIsExpanded(false)}
          aria-hidden="true"
        />
      )}
    <DashboardCard
      title="Council Comms"
      subtitle="IPC Hub Mirror"
      className={isExpanded ? "fixed inset-4 z-50 !min-h-0 shadow-2xl" : ""}
      headerAction={
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase">
          <button
            type="button"
            onClick={() => setIsExpanded((value) => !value)}
            className="flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-black/30 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
            title={isExpanded ? "Collapse panel (Esc)" : "Expand panel"}
            aria-label={isExpanded ? "Collapse Council Comms" : "Expand Council Comms"}
          >
            {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
          <Users className="h-3.5 w-3.5 text-primary" />
          <span className={status.ok ? "text-secondary" : "text-destructive"}>
            {status.ok ? `${status.sessions.length} linked` : "offline"}
          </span>
        </div>
      }
    >
      <div className={cn("flex flex-col gap-2", isExpanded ? "h-full" : "h-[clamp(640px,80vh,1040px)]")}>
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

        {/* Native session shortcuts — opens each agent's main session in its native web
            UI (openclaw control on 18789 by default). Only agents with a configured
            sessionUrl in council.config.local.json get a chip; if none are configured
            the row collapses to nothing. */}
        {identity && Object.entries(identity.agents).some(([, p]) => p.sessionUrl) && (
          <div className="flex flex-wrap items-center gap-1 rounded border border-white/10 bg-black/20 p-1">
            <span className="px-1 font-mono text-[8px] uppercase text-muted-foreground/70">Open session</span>
            {Object.entries(identity.agents)
              .filter(([, p]) => Boolean(p.sessionUrl))
              .map(([name, profile]) => (
                <a
                  key={name}
                  href={profile.sessionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-white/10 bg-white/[0.02] px-1.5 py-0.5 font-mono text-[9px] uppercase text-slate-200 transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                  title={`Open ${name} session in ${profile.role} web UI`}
                >
                  {name}
                </a>
              ))}
          </div>
        )}

        {/* Quick-pick chips for topics any agent is currently subscribed to. Lets the
            operator jump between filter scopes without typing topic names. Hub-side topic
            subscriptions are the actual filter mechanism — these chips just surface
            them client-side so they're usable from the HUD. */}
        {scope === "topic" && (() => {
          const knownTopics = Array.from(new Set(
            (status.sessions || []).flatMap((s) => s.topics || []).filter(Boolean)
          )).sort();
          if (knownTopics.length === 0) return null;
          return (
            <div className="flex flex-wrap items-center gap-1 rounded border border-white/10 bg-black/20 p-1">
              <span className="px-1 font-mono text-[8px] uppercase text-muted-foreground/70">Topics</span>
              {knownTopics.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTopic(cleanTopicName(t))}
                  className={cn(
                    "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase transition-colors",
                    cleanTopicName(t) === cleanTopicName(topic)
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-white/10 bg-white/[0.02] text-slate-200 hover:border-primary/30 hover:bg-primary/5"
                  )}
                  title={`Switch to #${t} topic`}
                >
                  #{t}
                </button>
              ))}
            </div>
          );
        })()}

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
          <div className="min-w-0 flex-1">
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
              onClick={() => setShowAcks((prev) => !prev)}
              className={cn(
                "h-8 w-8 border-white/10 bg-transparent p-0 hover:bg-white/5",
                showAcks && "border-secondary/40 text-secondary"
              )}
              title={showAcks ? "Hide bridge ACKs" : hiddenAckCount > 0 ? `Show ${hiddenAckCount} hidden delivery ACK${hiddenAckCount === 1 ? "" : "s"}` : "Show bridge ACKs"}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
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

        {bridgeStatus.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-white/10 bg-black/20 px-3 py-1.5 font-mono text-[8px] uppercase">
            <span className="text-muted-foreground/70">Bridges:</span>
            {bridgeStatus.map((bridge) => {
              const age = nowForBridgeAges - bridge.ts;
              const stale = age > BRIDGE_STALE_MS;
              const veryStale = age > BRIDGE_STALE_MS * 2;
              return (
                <span
                  key={bridge.name}
                  title={`Last delivery ack from ${bridge.name}: ${new Date(bridge.ts).toLocaleString()}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded border px-1",
                    veryStale ? "border-destructive/40 text-destructive" : stale ? "border-yellow-500/40 text-yellow-400" : "border-secondary/30 text-secondary"
                  )}
                >
                  {bridge.name.replace(/-bridge$/, "")}
                  <span className="text-muted-foreground/80">{formatAgeShort(age)}</span>
                </span>
              );
            })}
          </div>
        )}

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
                    <span className={cn("truncate font-bold", senderClass(message.sender, identity, sessionsByAgent))}>
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

        {(() => {
          const mention = parseMention(draft, identity);
          if (!mention) return null;
          return (
            <div className="rounded border border-primary/30 bg-primary/5 px-2 py-1 font-mono text-[9px] uppercase text-primary">
              ↳ @mention override → {mention.broadcast
                ? "broadcast to #council (every listening agent)"
                : `DM ${mention.agent} via ${mention.bridge}`}
            </div>
          );
        })()}

        <form onSubmit={handleSend} className="flex gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={scope === "dm" ? `DM ${target}... (or @<agent> / @all)` : scope === "broadcast" ? "Broadcast... (or @<agent> to DM)" : `Send to #${cleanTopicName(topic)}... (or @<agent> / @all)`}
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
            {allMessages.length} view{hiddenAckCount > 0 ? ` · ${hiddenAckCount} ack hidden` : ""}
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
    </>
  );
}
