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
  command: z.enum(['SET_PATH', 'KILL_PROCESS', 'READ_FILE', 'WRITE_FILE', 'NONE']).describe('The command.'),
  payload: z.record(z.any()).describe('The arguments.'),
  message: z.string().describe('The UI-facing response.'),
});
export type NexusCommandOutput = z.infer<typeof NexusCommandOutputSchema>;

const COMMANDS = ['SET_PATH', 'KILL_PROCESS', 'READ_FILE', 'WRITE_FILE', 'NONE'] as const;

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
  const selectedModel = getRuntimeEnvValue("NVIDIA_MODEL") || DEFAULT_NVIDIA_MODEL;

  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY is not set.");
  }

  const treeStr = JSON.stringify(input.context.fileTree || []).substring(0, 15000);
  const lastFileContent = input.context.lastReadFile?.content?.substring(0, 50000) || "None";
  const lastFilePath = input.context.lastReadFile?.path || "None";

  const historySection = (input.history || []).length > 0
    ? (input.history || []).map(m => `- ${m.role === 'model' ? 'Nexus_Op' : 'User'}: ${m.content}`).join('\n')
    : "No previous conversation history.";

  const systemInstruction = getRuntimeTextValue(NEXUS_SYSTEM_INSTRUCTION_KEY) || DEFAULT_NEXUS_SYSTEM_INSTRUCTION;
  const systemPrompt = buildNexusSystemPrompt({
    instruction: systemInstruction,
    workspace: input.context.workingDirectory || 'C:/',
    treeStr,
    lastFilePath,
    lastFileContent,
    historySection,
    userDirective: input.prompt,
  });

  try {
    const response = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input.prompt }
        ],
        temperature: 0.0,
        max_tokens: 4096,
      }),
    });

    const json = await response.json();
    const aiContent = json.choices?.[0]?.message?.content?.trim();

    if (!aiContent) {
      throw new Error(json?.error?.message || "Empty response from Neural Bridge.");
    }

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
    return { thought: "Network error.", command: 'NONE', payload: {}, message: `Bridge Offline: ${error.message}` };
  }
}
