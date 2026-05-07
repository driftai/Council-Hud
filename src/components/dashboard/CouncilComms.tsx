"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AlertCircle, MessagesSquare, RefreshCcw, Send, Users } from "lucide-react";

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
  content: string;
  topic: string;
  kind: string;
  priority: boolean;
};

type CouncilStatus = {
  ok: boolean;
  sessions: CouncilSession[];
  uptime?: number;
  error?: string | null;
};

const KIND_OPTIONS = ["chat", "status", "task", "ack", "error"];

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

export function CouncilComms() {
  const [status, setStatus] = useState<CouncilStatus>({ ok: false, sessions: [] });
  const [messages, setMessages] = useState<CouncilMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState("*");
  const [kind, setKind] = useState("chat");
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadStatus = async () => {
    const response = await fetch("/api/council/status", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    setStatus({
      ok: Boolean(data.ok),
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      uptime: Number(data.uptime || 0),
      error: data.error || null,
    });
    if (!response.ok) throw new Error(data.error || "Council status unavailable.");
  };

  const loadMessages = async () => {
    const response = await fetch("/api/council/messages?limit=100", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    setMessages(Array.isArray(data.messages) ? data.messages : []);
    if (!response.ok && response.status !== 206) throw new Error(data.error || "Council message tail unavailable.");
  };

  const refreshCouncil = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      await Promise.all([loadStatus(), loadMessages()]);
    } catch (refreshError: any) {
      setError(refreshError?.message || "Council bridge refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  };

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
    const messageInterval = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(messageInterval);
    };
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  const targetOptions = useMemo(() => {
    const seen = new Set<string>();
    return status.sessions
      .filter((session) => session.name && session.agent !== "operator")
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
  }, [status.sessions]);
  const targetLabel = target === "*"
    ? "#council broadcast"
    : targetOptions.find((option) => option.value === target)?.label || target;

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSending) return;

    setIsSending(true);
    setError(null);
    try {
      const response = await fetch("/api/council/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "operator",
          to: target,
          topic: target === "*" ? "council" : "",
          kind,
          content,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Council send failed.");
      }

      setDraft("");
      setTimeout(() => {
        loadMessages().catch(() => undefined);
      }, 600);
    } catch (sendError: any) {
      setError(sendError?.message || "Council send failed.");
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
      <div className="flex h-[430px] flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-black/20 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-[10px] uppercase text-primary">
              {target === "*" ? targetLabel : `DM: ${targetLabel}`}
            </p>
            <p className="truncate font-mono text-[8px] text-muted-foreground">
              {error || status.error || "Tail-reading Nova inbox and sending through authenticated WSL bridge."}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={refreshCouncil}
            disabled={isRefreshing}
            className="h-8 shrink-0 border-white/10 bg-transparent px-2 hover:bg-white/5"
            title="Refresh council bridge"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1 rounded border border-white/10 bg-black/30 p-3" viewportRef={scrollRef}>
          <div className="space-y-3 pr-2">
            {messages.length === 0 ? (
              <div className="flex items-center gap-2 rounded border border-white/10 bg-black/20 p-3 font-mono text-[10px] text-muted-foreground">
                <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
                Awaiting council packets.
              </div>
            ) : (
              messages.map((message) => (
                <div key={message.id} className="rounded border border-white/10 bg-white/[0.03] p-2">
                  <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[8px] uppercase">
                    <span className={cn("truncate font-bold", getSenderClass(message.sender))}>
                      {message.sender}
                    </span>
                    <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                      {message.kind !== "chat" && (
                        <span className="rounded border border-primary/20 px-1 text-primary">{message.kind}</span>
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

        <form onSubmit={handleSend} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="h-8 rounded border border-white/10 bg-black/40 px-2 font-mono text-[10px] uppercase text-slate-100 outline-none focus:border-primary/50"
            >
              <option value="*">#council</option>
              {targetOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
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
          <div className="flex gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Send to council..."
              className="min-h-16 resize-none border-white/10 bg-black/40 font-mono text-xs text-slate-100 focus-visible:ring-primary"
            />
            <Button
              type="submit"
              disabled={!draft.trim() || isSending}
              className="h-auto w-11 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
              title="Send council message"
            >
              {isSending ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      </div>
    </DashboardCard>
  );
}
