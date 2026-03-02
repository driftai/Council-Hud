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

export async function nexusCommand(input: NexusCommandInput): Promise<NexusCommandOutput> {
  const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
  const apiKey = process.env.NVIDIA_API_KEY;

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
1. ALWAYS use FORWARD SLASHES (/) for all paths (e.g., C:/Users/Alvin/Documents).
2. NEVER guess the content of a file. 
3. If "Last Read File Content" is provided below, you MUST use it to answer.
4. Respond with PURE JSON ONLY. 

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
    const aiContent = json.choices[0].message.content.trim();
    
    // extraction: Find the JSON block
    const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { thought: "Plain text response.", command: 'NONE', payload: {}, message: aiContent };
    }
    
    let rawJson = jsonMatch[0];

    // BACKSLASH EXORCIST: Replace raw backslashes with forward slashes 
    // to prevent "Bad escaped character" JSON errors.
    rawJson = rawJson.replace(/\\/g, "/");

    try {
      const parsed = JSON.parse(rawJson);
      return NexusCommandOutputSchema.parse({
        thought: parsed.thought || "Analyzing...",
        command: (parsed.command || 'NONE').toUpperCase(),
        payload: parsed.payload || {},
        message: parsed.message || "Directive acknowledged."
      });
    } catch (e: any) {
      console.error("Parse Fault:", rawJson);
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
