'use server';
/**
 * @fileOverview Nexus Commander V150 - Platinum State Edition.
 * 
 * V150 Enhancements:
 * - Platinum Pathing: Explicitly mandated Forward Slashes (/) for all paths.
 * - Backslash Exorcist: Recursively repairs AI-emitted Windows paths.
 * - Strict Schema Lock: Enforced via Zod.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getRuntimeEnvValue } from '@/lib/runtime-env';

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

  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY is not set.");
  }

  const treeStr = JSON.stringify(input.context.fileTree || []).substring(0, 15000);
  const lastFileContent = input.context.lastReadFile?.content?.substring(0, 50000) || "None";
  const lastFilePath = input.context.lastReadFile?.path || "None";

  const historySection = (input.history || []).length > 0
    ? (input.history || []).map(m => `- ${m.role === 'model' ? 'Nexus_Op' : 'User'}: ${m.content}`).join('\n')
    : "No previous conversation history.";

  let systemPrompt = `[SYSTEM_MANDATE]: YOU ARE A RAW JSON API BRIDGE.
[ROLE]: TRANSLATE human directives into SYSTEM ACTIONS.
[PLATINUM_PATHING]:
1. ALWAYS use FORWARD SLASHES (/) for all paths (e.g., C:/Users/USERNAME/Documents).
2. NEVER guess the content of a file. 
3. If "Last Read File Content" is provided below, you MUST use it to answer.
4. Respond with PURE JSON ONLY. 
5. The message field MUST be valid JSON string content: escape quotes, backslashes, and line breaks instead of writing raw multi-line text inside the JSON.
6. The message field MUST be readable natural language. NEVER put an object, array, or stringified JSON inside message.
7. Resolve follow-up references like "it", "that file", "inside it", "the text file", and "read it again" from HISTORY, Directory Tree, Workspace, and Last Read File Path.
8. If the user asks to read a file again, open a file here, view a file, or asks what a current file says, issue READ_FILE instead of answering from stale Last Read File Content.
9. If a referenced folder contains one matching text file, use that exact path instead of demanding that the user provide a full path.
10. If the user asks to open/show/view a file here, use command READ_FILE and include payload.openInspector=true.

[OUTPUT_RULES]:
- Response format: {"thought": "...", "command": "READ_FILE|NONE|...", "payload": {"path": "..."}, "message": "..."}

STATUS:
- Workspace: ${input.context.workingDirectory || 'C:/'}
- Directory Tree: ${treeStr}
- Last Read File Path: ${lastFilePath}
- Last Read File Content: """${lastFileContent}"""

HISTORY:
${historySection}

USER DIRECTIVE: "${input.prompt}"`;

  try {
    const response = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistralai/ministral-14b-instruct-2512",
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
