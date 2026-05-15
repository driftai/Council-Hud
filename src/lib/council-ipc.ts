import "server-only";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

import { loadCouncilConfig, type AgentMode } from "@/lib/council-config";

const TAIL_BYTES = 512 * 1024;
const ROLLOVER_MIN_BYTES = 4 * 1024;

export type CouncilSession = {
  name: string;
  agent: string;
  role: string;
  mode: AgentMode;
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

function normalizeAgentName(sessionName: string) {
  return sessionName.replace(/-bridge$/i, "").toLowerCase();
}

export function normalizeCouncilSessions(sessions: any[]): CouncilSession[] {
  const profiles = loadCouncilConfig().council.agents;
  return (Array.isArray(sessions) ? sessions : [])
    .map((session) => {
      const name = typeof session?.name === "string" ? session.name : "unknown";
      const agent = normalizeAgentName(name);
      const profile = profiles[agent] || {
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
  const cfg = loadCouncilConfig();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "wsl.exe",
      ["-d", cfg.wsl.distro, "--cd", cfg.wsl.workspaceDir, "--", "python3", "-c", script],
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
  const cfg = loadCouncilConfig();
  const healthUrl = `${cfg.hub.url}/health`;
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
    hubUrl: cfg.hub.url,
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
  const cfg = loadCouncilConfig();
  const live_path = cfg.journal.inboxPath;
  const rollover_path = cfg.journal.rolloverPath;
  let live = "";
  let liveError: unknown = null;
  try {
    live = await readTail(live_path);
  } catch (error) {
    liveError = error;
  }

  const liveBytes = Buffer.byteLength(live, "utf8");
  if (liveBytes >= ROLLOVER_MIN_BYTES) {
    return { raw: live, sources: [live_path] };
  }

  let rollover = "";
  try {
    rollover = await readTail(rollover_path);
  } catch {
    if (liveError && !live) throw liveError;
    return { raw: live, sources: [live_path] };
  }

  const combined = live ? `${rollover}\n${live}` : rollover;
  return { raw: combined, sources: [rollover_path, live_path] };
}

export async function readCouncilMessages(limit = 80) {
  const cfg = loadCouncilConfig();
  let raw = "";
  let sources: string[] = [cfg.journal.inboxPath];
  try {
    const result = await readJournalRaw();
    raw = result.raw;
    sources = result.sources;
  } catch {
    return {
      messages: [] as CouncilMessage[],
      source: cfg.journal.inboxPath,
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
  from,
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
  const cfg = loadCouncilConfig();
  const sender = from ?? cfg.council.defaultSender;
  const sendUrl = `${cfg.hub.url}/send`;
  const tokenPath = `${cfg.wsl.workspaceDir}/secrets/ipc-auth-token`;
  const payload: Record<string, string> = {
    from: sender,
    to,
    content,
    kind,
  };
  // The hub silently drops topic-less broadcasts. Always attach a topic for fanout sends ("*"),
  // defaulting to "council" so live agents subscribed to that channel receive it. DMs (to !== "*")
  // skip the topic on purpose so the hub routes them as a private direct message.
  if (to === "*") payload.topic = topic || "council";

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

// === IPC stack bootstrap ===
// Local-only orchestration helpers that drive the WSL-side IPC hub + bridges. The HTTP routes
// using these guard with canUseLocalCouncilApi, so this never gets reached from a remote browser.
// Responses below are deliberately sanitised — no absolute paths, no auth tokens, no raw stderr.
//
// Bridge identity (which agents to spawn, launcher script names, fallback python script) is
// loaded from council.config.local.json so the public repo carries only generic placeholders.

function runWslBash(commands: string[], timeoutMs = 10000) {
  const cfg = loadCouncilConfig();
  // Quoting via `bash -lc "<one big string>"` is fragile across the wsl.exe boundary —
  // single-quote contents (like awk's `$1`) can still get re-interpreted depending on how
  // wsl.exe reassembles argv on the Linux side. Send the script over stdin instead so bash
  // parses it like a normal script with no extra escaping layer.
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    const child = spawn(
      "wsl.exe",
      ["-d", cfg.wsl.distro, "-u", cfg.wsl.user, "--", "bash"],
      { windowsHide: true }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", () => resolve({ stdout, stderr, code: null }));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });

    child.stdin.write(commands.join("\n") + "\n");
    child.stdin.end();
  });
}

function detachedWslBash(commands: string[]) {
  const cfg = loadCouncilConfig();
  // start_new_session-style detach: child runs independently of the wsl.exe parent so it
  // survives once this Node handler returns to the client.
  const child = spawn(
    "wsl.exe",
    ["-d", cfg.wsl.distro, "-u", cfg.wsl.user, "--", "bash", "-lc", commands.join("; ")],
    { windowsHide: true, detached: true, stdio: "ignore" }
  );
  child.unref();
}

// Run a single long-lived daemon inside WSL. Unlike detachedWslBash this spawns wsl.exe with
// the daemon command directly (no bash one-liner), so wsl.exe's lifetime is tied to the
// daemon's. The Node process detaches via spawn options, so the chain wsl.exe → daemon
// outlives the HTTP handler that started it.
function spawnWslDaemon(daemonArgs: string[]) {
  const cfg = loadCouncilConfig();
  const child = spawn(
    "wsl.exe",
    ["-d", cfg.wsl.distro, "-u", cfg.wsl.user, "--", ...daemonArgs],
    { windowsHide: true, detached: true, stdio: "ignore" }
  );
  child.unref();
}

function sanitizeBootMessage(value: string) {
  // Strip absolute WSL home paths, token-ish strings, and trim noisy duplicate spaces so the UI
  // never surfaces filesystem layout or credential bytes.
  return value
    .replace(/\/home\/[A-Za-z0-9_.-]+/g, "~")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer …")
    .replace(/(token|secret|password)[=:]\s*\S+/gi, "$1=…")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
    .join("\n");
}

export type IpcStackStatus = {
  hubRunning: boolean;
  hubReachable: boolean;
  bridges: Array<{ agent: string; running: boolean }>;
  notes?: string;
};

export async function getIpcStackStatus(): Promise<IpcStackStatus> {
  const cfg = loadCouncilConfig();
  const bridgeTargets = cfg.council.bridges;
  // CAREFUL — any `pgrep -f <pattern>` here also matches its own orchestrating bash, because
  // the pattern string lives in the bash one-liner's argv. Instead we scan `ps -eo args` and
  // filter on the *first column* (the executable name): only count rows whose argv[0] is
  // python3/node, which automatically excludes shells, pgrep, awk and ps themselves.
  const probes = bridgeTargets.map((target) => (
    `echo --${target.agent} && ps -eo args 2>/dev/null | awk '/${target.fallbackScript.replace(".", "\\.")}/ && $1 ~ /python/ {n++} END {print n+0}'`
  ));
  const checkScript = [
    "echo --hub-proc",
    `ps -eo args 2>/dev/null | awk '/hub\\.mjs/ && $1 ~ /node/ {n++} END {print n+0}'`,
    ...probes,
    "echo --hub-reach",
    `curl -s -o /dev/null -w "%{http_code}" --max-time 2 ${cfg.hub.url.replace(/[$"`\\]/g, "")} 2>/dev/null || echo 000`,
  ];
  const { stdout } = await runWslBash(checkScript, 6000);
  const sections = stdout.split(/--([\w-]+)\n/).filter(Boolean);
  const data = new Map<string, string>();
  for (let i = 0; i < sections.length; i += 2) {
    const label = sections[i]?.trim();
    const body = sections[i + 1]?.trim() || "";
    if (label) data.set(label, body);
  }

  const hubCount = Number(data.get("hub-proc") || "0");
  const hubReachCode = Number((data.get("hub-reach") || "000").split(/\s+/).pop());
  const bridges = bridgeTargets.map((target) => ({
    agent: target.agent,
    running: Number(data.get(target.agent) || "0") > 0,
  }));

  return {
    hubRunning: hubCount > 0,
    hubReachable: hubReachCode >= 200 && hubReachCode < 500,
    bridges,
  };
}

export async function startIpcStack(): Promise<{ ok: boolean; message: string; status: IpcStackStatus }> {
  const cfg = loadCouncilConfig();
  const bridgeTargets = cfg.council.bridges;
  // Step 1: flip MCP configs back on via the upstream toggle script. Best-effort.
  await runWslBash([
    `bash ${cfg.wsl.workspaceDir}/scripts/ipc-toggle.sh on 2>&1 || true`,
  ], 15000);

  // Step 2: probe what's already running so we don't spawn duplicates.
  const initial = await getIpcStackStatus();

  // Step 3: spawn the hub as wsl.exe → node so the daemon's lifetime keeps wsl.exe alive.
  // Bash-and-nohup style detachment was tearing down before the daemon registered, killing
  // the process tree.
  if (!initial.hubRunning) {
    spawnWslDaemon(["node", cfg.wsl.hubScript]);
  }

  // Step 4: spawn each bridge that isn't already alive. council-* launchers daemonize via
  // python's --daemon flag (fork+setsid), bridge-ensure-one.py forks via start_new_session,
  // so both survive wsl.exe exit on their own merit once they've forked.
  for (const target of bridgeTargets) {
    const existing = initial.bridges.find((bridge) => bridge.agent === target.agent);
    if (existing?.running) continue;

    if (target.launcher) {
      spawnWslDaemon(["bash", "-c", `${cfg.wsl.workspaceDir}/scripts/${target.launcher} council`]);
    } else {
      spawnWslDaemon([
        "python3",
        `${cfg.wsl.workspaceDir}/scripts/bridge-ensure-one.py`,
        `${cfg.wsl.workspaceDir}/scripts/${target.fallbackScript}`,
        "--topic", "council", "--daemon",
      ]);
    }
  }

  // Step 5: wait + verify with a fresh status probe.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const status = await getIpcStackStatus();
  const liveBridges = status.bridges.filter((bridge) => bridge.running).length;
  return {
    ok: status.hubReachable && liveBridges === bridgeTargets.length,
    message: sanitizeBootMessage(`Hub ${status.hubRunning ? "up" : "down"} · ${liveBridges}/${bridgeTargets.length} bridges live`),
    status,
  };
}

export async function stopIpcStack(): Promise<{ ok: boolean; message: string; status: IpcStackStatus }> {
  // Best-effort shutdown: try the upstream off script first (clears MCP configs), then sweep any
  // stragglers. Either path is allowed to fail — we still report whatever the final state is.
  //
  // CAREFUL: a naïve `pkill -f 'bridge.py'` here matches its own parent bash because the cmdline
  // of `bash -lc "...; pkill -f 'bridge.py'; ..."` contains the literal string "bridge.py" in the
  // pkill argument — the bash gets SIGTERM'd before the trailing commands run. Same shape as the
  // getIpcStackStatus self-match: derive PIDs via `ps + awk` filtered on argv[0]=python3/node so
  // shells/awk/grep/pkill themselves are excluded by executable name, not by pattern matching.
  const sweep = [
    `for pid in $(ps -eo pid,args 2>/dev/null | awk '/-bridge\\.py/ && $2 ~ /python/ {print $1}'); do kill -TERM "$pid" 2>/dev/null || true; done`,
    `for pid in $(ps -eo pid,args 2>/dev/null | awk '/hub\\.mjs/ && $2 ~ /node/ {print $1}'); do kill -TERM "$pid" 2>/dev/null || true; done`,
  ];
  const cfg = loadCouncilConfig();
  const { stdout, stderr } = await runWslBash([
    `bash ${cfg.wsl.workspaceDir}/scripts/ipc-toggle.sh off 2>&1 || true`,
    ...sweep,
    `sleep 1`,
    // Second pass with SIGKILL for anything that refused SIGTERM.
    sweep[0].replace("-TERM", "-KILL"),
    sweep[1].replace("-TERM", "-KILL"),
    `echo done`,
  ], 20000);

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const status = await getIpcStackStatus();
  return {
    ok: !status.hubRunning && status.bridges.every((bridge) => !bridge.running),
    message: sanitizeBootMessage(stdout || stderr || "ipc stack stopped"),
    status,
  };
}
