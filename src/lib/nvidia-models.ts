export const DEFAULT_NVIDIA_MODEL = "mistralai/ministral-14b-instruct-2512";

export type NvidiaModelSort = "recommended" | "score" | "reasoning" | "coding" | "speed" | "name" | "provider";

export type NvidiaRawModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
};

export type NvidiaModelOption = {
  id: string;
  provider: string;
  label: string;
  category: string;
  selectable: boolean;
  capabilities: string[];
  score: number;
  scores: {
    reasoning: number;
    coding: number;
    speed: number;
    chat: number;
  };
  created?: number;
  rankNote: string;
};

const NON_BRAIN_PATTERNS = [
  "embed",
  "embedding",
  "rerank",
  "retrieval",
  "clip",
  "dinov2",
  "yolo",
  "sam2",
  "segment",
  "diffusion",
  "stable-diffusion",
  "flux",
  "image",
  "video",
  "tts",
  "asr",
  "speech",
  "audio",
  "molecular",
  "protein",
  "chem",
  "medusa",
];

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function modelSizeBoost(id: string) {
  const matches = Array.from(id.matchAll(/(\d+)\s*b/g));
  const largest = matches.reduce((max, match) => Math.max(max, Number(match[1])), 0);
  if (largest >= 400) return 14;
  if (largest >= 200) return 12;
  if (largest >= 100) return 10;
  if (largest >= 70) return 8;
  if (largest >= 30) return 5;
  if (largest >= 14) return 3;
  return 0;
}

function inferCategory(id: string, selectable: boolean) {
  if (!selectable) {
    if (includesAny(id, ["embed", "bge", "e5"])) return "Embedding";
    if (includesAny(id, ["rerank"])) return "Reranker";
    if (includesAny(id, ["vl", "vision", "fuyu", "llava"])) return "Vision";
    if (includesAny(id, ["image", "diffusion", "flux"])) return "Image";
    return "Non-chat";
  }

  if (includesAny(id, ["coder", "codestral", "code", "starcoder", "devstral"])) return "Coding";
  if (includesAny(id, ["reason", "r1", "nemotron", "qwen3", "thinking"])) return "Reasoning";
  if (includesAny(id, ["flash", "mini", "small", "nano", "lite"])) return "Fast";
  return "General";
}

export function scoreNvidiaModel(rawModel: NvidiaRawModel): NvidiaModelOption {
  const id = String(rawModel.id || "").trim();
  const lower = id.toLowerCase();
  const provider = rawModel.owned_by || id.split("/")[0] || "unknown";
  const selectable = Boolean(id) && !includesAny(lower, NON_BRAIN_PATTERNS);
  const capabilities = new Set<string>();

  let overall = selectable ? 35 : 5;
  let reasoning = selectable ? 30 : 0;
  let coding = selectable ? 25 : 0;
  let speed = selectable ? 35 : 0;
  let chat = selectable ? 45 : 0;
  const notes: string[] = [];

  if (includesAny(lower, ["chat", "instruct", "it", "assistant"])) {
    overall += 8;
    chat += 18;
    capabilities.add("chat");
  }

  if (includesAny(lower, ["reason", "r1", "thinking"])) {
    overall += 15;
    reasoning += 30;
    capabilities.add("reasoning");
  }

  if (includesAny(lower, ["coder", "codestral", "code", "starcoder", "devstral"])) {
    overall += 12;
    coding += 32;
    capabilities.add("coding");
  }

  if (includesAny(lower, ["agent", "tool", "nemotron", "qwen3", "kimi-k2"])) {
    overall += 10;
    reasoning += 10;
    capabilities.add("agentic");
  }

  if (includesAny(lower, ["flash", "mini", "small", "nano", "lite"])) {
    speed += 28;
    overall += 3;
    capabilities.add("fast");
  }

  if (includesAny(lower, ["large", "70b", "120b", "235b", "253b", "405b", "671b"])) {
    capabilities.add("large");
  }

  overall += modelSizeBoost(lower);

  if (lower.includes("nemotron-3-super")) {
    overall += 30;
    reasoning += 34;
    coding += 18;
    chat += 22;
    capabilities.add("reasoning");
    capabilities.add("agentic");
    notes.push("NVIDIA documents Nemotron 3 Super for agentic reasoning and collaborative agent use.");
  } else if (lower.includes("nemotron")) {
    overall += 22;
    reasoning += 26;
    chat += 16;
    capabilities.add("reasoning");
    capabilities.add("agentic");
    notes.push("Nemotron family receives a boost from NVIDIA/independent open-model rankings.");
  }

  if (lower.includes("deepseek")) {
    overall += lower.includes("coder") ? 18 : 26;
    reasoning += 24;
    coding += lower.includes("coder") ? 26 : 12;
    capabilities.add("reasoning");
    notes.push("DeepSeek family is heavily represented in recent open-model leaderboards.");
  }

  if (lower.includes("qwen")) {
    overall += lower.includes("coder") ? 24 : 25;
    reasoning += 25;
    coding += lower.includes("coder") ? 28 : 12;
    capabilities.add("reasoning");
    notes.push("Qwen family is heavily represented in recent open-model leaderboards.");
  }

  if (lower.includes("kimi")) {
    overall += 23;
    reasoning += 20;
    coding += 14;
    capabilities.add("agentic");
    notes.push("Kimi family appears in recent open-model ranking summaries.");
  }

  if (lower.includes("minimax") || lower.includes("glm")) {
    overall += 18;
    reasoning += 18;
    coding += 10;
    notes.push("Recent open-model rankings include strong GLM/MiniMax-family models.");
  }

  if (lower.includes("llama-3.3") || lower.includes("llama-4")) {
    overall += 18;
    reasoning += 14;
    chat += 15;
    notes.push("Llama family remains a strong open-model baseline.");
  }

  if (lower.includes("mistral") || lower.includes("magistral")) {
    overall += 15;
    reasoning += lower.includes("magistral") ? 18 : 8;
    coding += lower.includes("codestral") ? 24 : 10;
    notes.push("Mistral/Magistral models are strong general and code-capable options.");
  }

  if (!selectable) {
    capabilities.add("not-agent-brain");
    overall = Math.min(overall, 20);
  }

  if (capabilities.size === 0) capabilities.add("general");

  return {
    id,
    provider,
    label: id,
    category: inferCategory(lower, selectable),
    selectable,
    capabilities: Array.from(capabilities),
    score: clampScore(overall),
    scores: {
      reasoning: clampScore(reasoning),
      coding: clampScore(coding),
      speed: clampScore(speed),
      chat: clampScore(chat),
    },
    created: rawModel.created,
    rankNote: notes[0] || "Scored from model id, chat suitability, size hints, and public family-level ranking signals.",
  };
}

export function sortNvidiaModels(models: NvidiaModelOption[], sort: NvidiaModelSort) {
  const sorted = [...models];
  const scoreForSort = (model: NvidiaModelOption) => {
    if (sort === "reasoning") return model.scores.reasoning;
    if (sort === "coding") return model.scores.coding;
    if (sort === "speed") return model.scores.speed;
    return model.score;
  };

  sorted.sort((a, b) => {
    if (sort === "name") return a.id.localeCompare(b.id);
    if (sort === "provider") return a.provider.localeCompare(b.provider) || b.score - a.score || a.id.localeCompare(b.id);

    const selectableDelta = Number(b.selectable) - Number(a.selectable);
    if (selectableDelta !== 0) return selectableDelta;

    const scoreDelta = scoreForSort(b) - scoreForSort(a);
    if (scoreDelta !== 0) return scoreDelta;

    return a.id.localeCompare(b.id);
  });

  return sorted;
}

export function normalizeNvidiaModelSort(value: unknown): NvidiaModelSort {
  const sort = typeof value === "string" ? value : "";
  if (["recommended", "score", "reasoning", "coding", "speed", "name", "provider"].includes(sort)) {
    return sort as NvidiaModelSort;
  }
  return "recommended";
}
