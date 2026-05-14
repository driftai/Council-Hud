'use server';
/**
 * @fileOverview Nexus Commander V150 - Platinum State Edition.
 * 
 * V150 Enhancements:
 * - Platinum Pathing: Explicitly mandated Forward Slashes (/) for all paths.
 * - Backslash Exorcist: Recursively repairs AI-emitted Windows paths.
 * - Strict Schema Lock: Enforced via Zod.
 */

import { z } from 'genkit';
import { getRuntimeEnvValue, getRuntimeTextValue } from '@/lib/runtime-env';
import { DEFAULT_NVIDIA_MODEL } from '@/lib/nvidia-models';
import {
  buildNexusSystemPrompt,
  DEFAULT_NEXUS_SYSTEM_INSTRUCTION,
  NEXUS_SYSTEM_INSTRUCTION_KEY,
} from '@/lib/nexus-system-instruction';
import { recordModelOutcome, resolveRoutableModel } from '@/lib/smart-fallback';

const MessageSchema = z.object({
  role: z.enum(['user', 'model']),
  content: z.string(),
});

const NexusCommandInputSchema = z.object({
  prompt: z.string().describe('The user instruction in natural language.'),
  history: z.array(MessageSchema).optional().describe('Previous turns of the conversation.'),
  context: z.object({
    processes: z.array(z.any()).optional(),
    fileTree: z.any().optional(),
    systemHealth: z.any().optional(),
    systemHealthAverage: z.any().optional(),
    connectionState: z.string().optional(),
    currentUrl: z.string().optional(),
    workingDirectory: z.string().optional(),
    lastReadFile: z.object({
      path: z.string(),
      content: z.string(),
    }).optional(),
  }).describe('The real-time state of the remote hardware node.'),
});
export type NexusCommandInput = z.infer<typeof NexusCommandInputSchema>;

const NexusCommandOutputSchema = z.object({
  thought: z.string().describe('The internal reasoning.'),
  command: z.enum(['SET_PATH', 'KILL_PROCESS', 'READ_FILE', 'WRITE_FILE', 'DELETE_FILE', 'RENAME_FILE', 'NONE']).describe('The command.'),
  payload: z.record(z.any()).describe('The arguments.'),
  message: z.string().describe('The UI-facing response.'),
});
export type NexusCommandOutput = z.infer<typeof NexusCommandOutputSchema>;

const COMMANDS = ['SET_PATH', 'KILL_PROCESS', 'READ_FILE', 'WRITE_FILE', 'DELETE_FILE', 'RENAME_FILE', 'NONE'] as const;
const RATE_LIMIT_RETRIES = 2;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripCodeFence(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function collectJsonCandidates(value: string) {
  const source = stripCodeFence(value);
  const candidates = new Set<string>();
  if (source.startsWith("{")) candidates.add(source);

  for (let start = 0; start < source.length; start++) {
    if (source[start] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index++) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.add(source.slice(start, index + 1));
          break;
        }
      }
    }
  }

  return Array.from(candidates);
}

function repairInvalidJsonBackslashes(value: string) {
  return value.replace(/\\(?!["\\/bfnrtu])/g, "/");
}

function escapeBareControlCharsInStrings(value: string) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
      } else if (char === "\\") {
        output += char;
        escaped = true;
      } else if (char === "\"") {
        output += char;
        inString = false;
      } else if (char === "\n") {
        output += "\\n";
      } else if (char === "\r") {
        output += "\\r";
      } else if (char === "\t") {
        output += "\\t";
      } else {
        output += char;
      }
      continue;
    }

    output += char;
    if (char === "\"") inString = true;
  }

  return output;
}

function parseLooseJson(candidate: string) {
  const attempts = new Set([
    candidate,
    repairInvalidJsonBackslashes(candidate),
    escapeBareControlCharsInStrings(candidate),
    escapeBareControlCharsInStrings(repairInvalidJsonBackslashes(candidate)),
  ]);

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function normalizePayloadPaths(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    return /path|filepath|directory|folder|cwd/i.test(key) ? value.replace(/\\/g, "/") : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizePayloadPaths(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        normalizePayloadPaths(childValue, childKey),
      ])
    );
  }

  return value;
}

function normalizeCommand(value: unknown): NexusCommandOutput["command"] {
  const command = typeof value === "string" ? value.trim().toUpperCase() : "NONE";
  return COMMANDS.includes(command as NexusCommandOutput["command"])
    ? command as NexusCommandOutput["command"]
    : "NONE";
}

function formatNumber(value: unknown, suffix = "") {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.abs(numeric) >= 100 ? numeric.toFixed(0) : numeric.toFixed(1);
  const cleaned = rounded.replace(/\.0$/, "");
  return `${cleaned}${suffix}`;
}

function formatUptime(secondsRaw: unknown) {
  const secondsNum = Number(secondsRaw);
  if (!Number.isFinite(secondsNum) || secondsNum <= 0) return null;
  const seconds = Math.floor(secondsNum);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function summarizeProcesses(processes: unknown) {
  if (!Array.isArray(processes) || processes.length === 0) return null;
  const ranked = processes
    .filter((proc): proc is Record<string, any> => Boolean(proc) && typeof proc === "object")
    .map((proc) => ({
      name: String(proc.name || proc.title || proc.label || proc.id || "process"),
      pid: Number.isFinite(Number(proc.pid ?? proc.id)) ? Number(proc.pid ?? proc.id) : null,
      cpu: Number.isFinite(Number(proc.usage ?? proc.cpu)) ? Number(proc.usage ?? proc.cpu) : null,
      memory: Number.isFinite(Number(proc.memory ?? proc.mem)) ? Number(proc.memory ?? proc.mem) : null,
    }))
    .filter((proc) => {
      const name = proc.name.toLowerCase();
      if (proc.pid === 0) return false;
      if (name === "system idle process" || name === "idle") return false;
      return true;
    })
    .sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0))
    .slice(0, 6)
    .map((proc) => {
      const cpu = proc.cpu !== null ? `cpu ${formatNumber(proc.cpu, "%")}` : "";
      const mem = proc.memory !== null ? `mem ${formatNumber(proc.memory, "%")}` : "";
      const tail = [cpu, mem].filter(Boolean).join(", ");
      return tail ? `${proc.name} (${tail})` : proc.name;
    });
  if (ranked.length === 0) return null;
  return ranked.join(", ");
}

function formatTelemetrySection(context: NexusCommandInput["context"]) {
  const lines: string[] = [];
  const health = (context.systemHealth || {}) as Record<string, any>;
  const average = (context.systemHealthAverage || {}) as Record<string, any>;
  const hasHealth = health && Object.keys(health).length > 0;

  if (context.connectionState) lines.push(`- Connection state: ${context.connectionState}`);
  if (context.currentUrl) lines.push(`- Bridge URL: ${context.currentUrl}`);

  if (hasHealth) {
    const cpu = formatNumber(health.cpu_load, "%");
    const ram = formatNumber(health.ram_used, "%");
    const temp = formatNumber(health.cpu_temp, "°C");
    const uptime = formatUptime(health.uptime);
    if (cpu) {
      const avg = formatNumber(average.cpuLoad, "%");
      lines.push(`- CPU load: ${cpu}${avg ? ` (avg ${avg} over last ${average.windowSeconds || 60}s)` : ""}`);
    }
    if (ram) {
      const avg = formatNumber(average.ramUsed, "%");
      lines.push(`- RAM used: ${ram}${avg ? ` (avg ${avg} over last ${average.windowSeconds || 60}s)` : ""}`);
    }
    if (temp) {
      const avg = formatNumber(average.cpuTemp, "°C");
      const source = typeof health.cpu_temp_source === "string" ? health.cpu_temp_source : "";
      lines.push(`- CPU temp: ${temp}${avg ? ` (avg ${avg} over last ${average.windowSeconds || 60}s)` : ""}${source ? ` [${source}]` : ""}`);
    }
    if (uptime) lines.push(`- System uptime: ${uptime}`);
    if (typeof health.status === "string") lines.push(`- Node status: ${health.status}`);
  } else {
    lines.push("- Telemetry: hardware uplink offline.");
  }

  const processSummary = summarizeProcesses(context.processes);
  if (processSummary) lines.push(`- Top processes: ${processSummary}`);

  lines.push("- Use these numbers when the user asks for system health, averages, temperature, load, or running processes. Do not say you lack access while telemetry is present here.");

  return lines.join("\n");
}

function normalizeCommandOutput(parsed: any): NexusCommandOutput {
  const payload = parsed?.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)
    ? normalizePayloadPaths(parsed.payload)
    : {};

  return NexusCommandOutputSchema.parse({
    thought: typeof parsed?.thought === "string" ? parsed.thought : "Analyzing...",
    command: normalizeCommand(parsed?.command),
    payload,
    message: typeof parsed?.message === "string" ? parsed.message : "Directive acknowledged.",
  });
}

export async function nexusCommand(input: NexusCommandInput): Promise<NexusCommandOutput> {
  const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
  const apiKey = getRuntimeEnvValue("NVIDIA_API_KEY");
  const preferredModel = getRuntimeEnvValue("NVIDIA_MODEL") || DEFAULT_NVIDIA_MODEL;

  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY is not set.");
  }

  const treeStr = JSON.stringify(input.context.fileTree || []).substring(0, 15000);
  const lastFileContent = input.context.lastReadFile?.content?.substring(0, 50000) || "None";
  const lastFilePath = input.context.lastReadFile?.path || "None";

  const historySection = (input.history || []).length > 0
    ? (input.history || []).map(m => `- ${m.role === 'model' ? 'Nexus_Op' : 'User'}: ${m.content}`).join('\n')
    : "No previous conversation history.";

  const telemetrySection = formatTelemetrySection(input.context);

  const systemInstruction = getRuntimeTextValue(NEXUS_SYSTEM_INSTRUCTION_KEY) || DEFAULT_NEXUS_SYSTEM_INSTRUCTION;
  const systemPrompt = buildNexusSystemPrompt({
    instruction: systemInstruction,
    workspace: input.context.workingDirectory || 'C:/',
    treeStr,
    lastFilePath,
    lastFileContent,
    historySection,
    userDirective: input.prompt,
    telemetrySection,
  });

  // Smart-fallback pre-flight: ask the engine whether our preferred model is currently routable.
  // When it's not (circuit open with cooldown remaining), the engine hands us a healthy fallback.
  // If the engine is unreachable, we proceed with the user's choice.
  const initial = await resolveRoutableModel(preferredModel);
  let currentModel = initial.model;
  const triedModels = new Set<string>([currentModel]);
  if (initial.source === "fallback") {
    console.info(`[smart-fallback] '${preferredModel}' is ${initial.routability?.circuit_state} (${initial.routability?.cooldown_remaining}s cooldown) — swapping to '${currentModel}' for this turn.`);
  }

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await fetch(NVIDIA_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: currentModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: input.prompt }
          ],
          temperature: 0.0,
          max_tokens: 4096,
        }),
      });

      const responseText = await response.text();
      let json: any;
      try {
        json = JSON.parse(responseText);
      } catch {
        recordModelOutcome(currentModel, "error", `non_json_${response.status}`);
        throw new Error(`Neural Bridge returned non-JSON response (${response.status}).`);
      }
      if (!response.ok) {
        const errMsg = json?.error?.message || `Neural Bridge HTTP ${response.status}.`;
        if (response.status === 429 || /rate.?limit|too many requests/i.test(errMsg)) {
          recordModelOutcome(currentModel, "rate_limit", "rate_limit");
          throw new Error(`429 rate limit: ${errMsg}`);
        }
        recordModelOutcome(currentModel, "error", `http_${response.status}`);
        throw new Error(errMsg);
      }
      const aiContent = json.choices?.[0]?.message?.content?.trim();

      if (!aiContent) {
        recordModelOutcome(currentModel, "error", "empty_response");
        throw new Error(json?.error?.message || "Empty response from Neural Bridge.");
      }

      // Healthy response — feed latency back to the engine so it scores this model fairly.
      recordModelOutcome(currentModel, "success", Date.now() - startedAt);

      const candidates = collectJsonCandidates(aiContent);
      if (candidates.length === 0) {
        return { thought: "Plain text response.", command: 'NONE', payload: {}, message: aiContent };
      }

      try {
        for (const candidate of candidates) {
          try {
            return normalizeCommandOutput(parseLooseJson(candidate));
          } catch {
            continue;
          }
        }

        throw new Error("No parseable JSON candidate found.");
      } catch (e: any) {
        console.error("Parse Fault:", e.message);
        return {
          thought: `Extraction Fault: ${e.message}`,
          command: 'NONE',
          payload: {},
          message: "Neural Bridge Interrupted: Invalid JSON Structure Received."
        };
      }
    } catch (error: any) {
      const message = error.message || "Network Timeout";
      const rateLimited = /429|rate limit/i.test(message);

      if (rateLimited && attempt < RATE_LIMIT_RETRIES) {
        // Don't pound the same model — ask the engine for a healthier one we haven't tried yet.
        const swap = await resolveRoutableModel(currentModel);
        if (swap.source === "fallback" && swap.model && !triedModels.has(swap.model)) {
          console.info(`[smart-fallback] 429 on '${currentModel}' — switching to '${swap.model}' for retry.`);
          currentModel = swap.model;
          triedModels.add(currentModel);
          continue;
        }
        // Engine had nothing fresh — backoff and retry the same model as last resort.
        await delay(800 * Math.pow(2, attempt));
        continue;
      }
      return { thought: "Network error.", command: 'NONE', payload: {}, message: `Bridge Offline: ${message}` };
    }
  }

  return { thought: "Network error.", command: 'NONE', payload: {}, message: "Bridge Offline: Unknown failure" };
}
