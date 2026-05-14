import "server-only";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

const WSL_DISTRO = process.env.COUNCIL_WSL_DISTRO || "Ubuntu";
const WSL_WORKSPACE = "/home/linux-user/.openclaw/workspace";
const HUB_URL = process.env.COUNCIL_HUB_URL || "http://10.255.255.254:3179";
const WORKSPACE_UNC = process.env.COUNCIL_WORKSPACE_UNC
  || "\\\\wsl.localhost\\Ubuntu\\home\\linux-user\\.openclaw\\workspace";
// Read the universal IPC journal — every council packet (drift, eve, prime, echo, vesper, meru, bridges)
// lands here. Per-agent inboxes like nova-inbox.jsonl only contain that agent's filtered slice and go
// stale whenever the agent disconnects.
const INBOX_JSONL = process.env.COUNCIL_INBOX_JSONL
  || `${WORKSPACE_UNC}\\logs\\council-journal.jsonl`;
// When the live journal has just rotated and is small, fall back to the previous file so the HUD
// still shows recent context.
const INBOX_JSONL_ROLLOVER = process.env.COUNCIL_INBOX_JSONL_PREV
  || `${INBOX_JSONL}.1`;
const TAIL_BYTES = 512 * 1024;
const ROLLOVER_MIN_BYTES = 4 * 1024;

export type CouncilSession = {
  name: string;
  agent: string;
  role: string;
  mode: "operator" | "live" | "viewer" | "bridge";
  connectedAt: number;
  topics: string[];
};

export type CouncilMessage = {
  id: string;
  timestamp: string;
  sender: string;
  to: string;
  content: string;
  topic: string;
  kind: string;
  priority: boolean;
};

const AGENT_PROFILES: Record<string, Pick<CouncilSession, "role" | "mode">> = {
  drift: { role: "Operator", mode: "operator" },
  eve: { role: "OpenClaw Live", mode: "live" },
  prime: { role: "OpenClaw Live", mode: "live" },
  echo: { role: "OpenClaw Live", mode: "live" },
  vesper: { role: "OpenClaw Live", mode: "live" },
  meru: { role: "Hermes Live", mode: "live" },
  iris: { role: "Viewer Bridge", mode: "viewer" },
  nova: { role: "Viewer Bridge", mode: "viewer" },
  astro: { role: "Viewer Bridge", mode: "viewer" },
};

function normalizeAgentName(sessionName: string) {
  return sessionName.replace(/-bridge$/i, "").toLowerCase();
}

export function normalizeCouncilSessions(sessions: any[]): CouncilSession[] {
  return (Array.isArray(sessions) ? sessions : [])
    .map((session) => {
      const name = typeof session?.name === "string" ? session.name : "unknown";
      const agent = normalizeAgentName(name);
      const profile = AGENT_PROFILES[agent] || {
        role: name.endsWith("-bridge") ? "Council Bridge" : "Council Session",
        mode: name.endsWith("-bridge") ? "bridge" as const : "live" as const,
      };

      return {
        name,
        agent,
        role: profile.role,
        mode: profile.mode,
        connectedAt: Number(session?.connectedAt || 0),
        topics: Array.isArray(session?.topics) ? session.topics.map(String) : [],
      };
    })
    .sort((a, b) => {
      const modeOrder = { operator: 0, live: 1, viewer: 2, bridge: 3 };
      return modeOrder[a.mode] - modeOrder[b.mode] || a.agent.localeCompare(b.agent);
    });
}

function runWslPython(script: string, input?: unknown, timeoutMs = 6000) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "wsl.exe",
      ["-d", WSL_DISTRO, "--cd", WSL_WORKSPACE, "--", "python3", "-c", script],
      { windowsHide: true }
    );
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Council WSL bridge timed out."));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `Council WSL bridge exited with ${code}.`));
      }
    });

    if (input !== undefined) {
      child.stdin.write(JSON.stringify(input));
    }
    child.stdin.end();
  });
}

export async function fetchCouncilHealth() {
  const healthUrl = `${HUB_URL}/health`;
  const script = `
import json
import sys
import urllib.request

try:
    with urllib.request.urlopen(${JSON.stringify(healthUrl)}, timeout=3) as response:
        sys.stdout.write(response.read().decode("utf-8"))
except Exception as exc:
    sys.stdout.write(json.dumps({"ok": False, "sessions": [], "uptime": 0, "error": str(exc)}))
`;
  const raw = await runWslPython(script);
  const data = JSON.parse(raw || "{}");
  return {
    ok: Boolean(data.ok),
    sessions: normalizeCouncilSessions(data.sessions || []),
    uptime: Number(data.uptime || 0),
    error: typeof data.error === "string" ? data.error : null,
    hubUrl: HUB_URL,
  };
}

async function readTail(filePath: string, maxBytes = TAIL_BYTES) {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

function buildMessageId(message: CouncilMessage, index: number) {
  return `${message.timestamp}|${message.sender}|${message.kind}|${index}|${message.content.slice(0, 40)}`;
}

async function readJournalRaw(): Promise<{ raw: string; sources: string[] }> {
  let live = "";
  let liveError: unknown = null;
  try {
    live = await readTail(INBOX_JSONL);
  } catch (error) {
    liveError = error;
  }

  const liveBytes = Buffer.byteLength(live, "utf8");
  if (liveBytes >= ROLLOVER_MIN_BYTES) {
    return { raw: live, sources: [INBOX_JSONL] };
  }

  let rollover = "";
  try {
    rollover = await readTail(INBOX_JSONL_ROLLOVER);
  } catch {
    if (liveError && !live) throw liveError;
    return { raw: live, sources: [INBOX_JSONL] };
  }

  const combined = live ? `${rollover}\n${live}` : rollover;
  return { raw: combined, sources: [INBOX_JSONL_ROLLOVER, INBOX_JSONL] };
}

export async function readCouncilMessages(limit = 80) {
  let raw = "";
  let sources: string[] = [INBOX_JSONL];
  try {
    const result = await readJournalRaw();
    raw = result.raw;
    sources = result.sources;
  } catch {
    return {
      messages: [] as CouncilMessage[],
      source: INBOX_JSONL,
      error: "Council journal is not readable yet.",
    };
  }

  const messages = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const parsed = JSON.parse(line);
        const message: CouncilMessage = {
          id: "",
          timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
          sender: String(parsed.sender || parsed.from || "unknown"),
          to: String(parsed.to || "*"),
          content: String(parsed.content || parsed.message || parsed.text || ""),
          topic: String(parsed.topic || "council"),
          kind: String(parsed.kind || "chat"),
          priority: Boolean(parsed.priority),
        };
        message.id = buildMessageId(message, index);
        return message;
      } catch {
        return null;
      }
    })
    .filter((message): message is CouncilMessage => Boolean(message))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-Math.max(1, Math.min(200, limit)));

  return {
    messages,
    source: sources.join(" + "),
    error: null,
  };
}

export async function sendCouncilMessage({
  content,
  from = "operator",
  to = "*",
  topic = "council",
  kind = "chat",
}: {
  content: string;
  from?: string;
  to?: string;
  topic?: string | null;
  kind?: string;
}) {
  const sendUrl = `${HUB_URL}/send`;
  const tokenPath = `${WSL_WORKSPACE}/secrets/ipc-auth-token`;
  const payload: Record<string, string> = {
    from,
    to,
    content,
    kind,
  };
  if (to === "*" && topic !== null) payload.topic = topic || "council";

  const script = `
import json
import sys
import urllib.request

payload = json.load(sys.stdin)
with open(${JSON.stringify(tokenPath)}, "r", encoding="utf-8") as token_file:
    token = token_file.read().strip()

request = urllib.request.Request(
    ${JSON.stringify(sendUrl)},
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
    },
    method="POST",
)
with urllib.request.urlopen(request, timeout=5) as response:
    sys.stdout.write(response.read().decode("utf-8"))
`;
  const raw = await runWslPython(script, payload, 8000);
  return JSON.parse(raw || "{}");
}
