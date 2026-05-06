import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_NVIDIA_MODEL, normalizeNvidiaModelSort, scoreNvidiaModel, sortNvidiaModels } from "@/lib/nvidia-models";
import { getRuntimeEnvValue, hasRuntimeEnvValue, setRuntimeEnvValue } from "@/lib/runtime-env";

export const runtime = "nodejs";

const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";

function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost"
    || host === "127.0.0.1"
    || host === "::1"
    || host.endsWith(".localhost")
    || /^192\.168\./.test(host)
    || /^10\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function canWriteRuntimeConfig(request: NextRequest) {
  if (process.env.NEXUS_ALLOW_PUBLIC_RUNTIME_CONFIG === "1") return true;
  return isSameOrigin(request) && isLocalHost(request.nextUrl.hostname);
}

async function fetchNvidiaModels() {
  const apiKey = getRuntimeEnvValue("NVIDIA_API_KEY");
  if (!apiKey) {
    return {
      configured: false,
      models: [],
      error: "NVIDIA_API_KEY is not set.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(NVIDIA_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        configured: true,
        models: [],
        error: data?.error?.message || `NVIDIA model list failed with ${response.status}.`,
      };
    }

    const seen = new Set<string>();
    const models = (Array.isArray(data?.data) ? data.data : [])
      .filter((model: any) => {
        const id = typeof model?.id === "string" ? model.id : "";
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map(scoreNvidiaModel);

    return {
      configured: true,
      models,
      error: null,
    };
  } catch (error: any) {
    return {
      configured: true,
      models: [],
      error: error?.name === "AbortError"
        ? "NVIDIA model list request timed out."
        : error?.message || "NVIDIA model list request failed.",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest) {
  const sort = normalizeNvidiaModelSort(request.nextUrl.searchParams.get("sort"));
  const selectedModel = getRuntimeEnvValue("NVIDIA_MODEL") || DEFAULT_NVIDIA_MODEL;
  const result = await fetchNvidiaModels();
  const sortedModels = sortNvidiaModels(result.models, sort);

  return NextResponse.json({
    configured: result.configured,
    selectedModel,
    defaultModel: DEFAULT_NVIDIA_MODEL,
    sort,
    models: sortedModels,
    modelCount: sortedModels.length,
    selectableCount: sortedModels.filter((model) => model.selectable).length,
    scoreNote: "Usefulness score is a local heuristic from NVIDIA model ids, chat suitability, capability tags, and public family-level ranking signals.",
    error: result.error,
  }, { status: result.configured || !result.error ? 200 : 400 });
}

export async function POST(request: NextRequest) {
  if (!canWriteRuntimeConfig(request)) {
    return NextResponse.json(
      { error: "Runtime model storage is only enabled from the local HUD host." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const model = typeof body?.model === "string" ? body.model.trim() : "";

  if (!model) {
    return NextResponse.json({ error: "NVIDIA model id is required." }, { status: 400 });
  }

  if (!/^[A-Za-z0-9._:/-]+$/.test(model) || !model.includes("/")) {
    return NextResponse.json({ error: "NVIDIA model id should look like provider/model-name." }, { status: 400 });
  }

  setRuntimeEnvValue("NVIDIA_MODEL", model);

  return NextResponse.json({
    configured: hasRuntimeEnvValue("NVIDIA_API_KEY"),
    selectedModel: model,
  });
}
