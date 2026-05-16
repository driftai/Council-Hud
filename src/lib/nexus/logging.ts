export const NEXUS_LOG_LABELS: Record<string, string> = {
  HARDWARE_PULSE: "Hardware Pulse",
  PROCESS_GRAPH: "Process Graph",
  FILESYSTEM_TREE: "Mirror Scan",
  FILE_READ: "File Read",
  FILE_WRITE: "File Write",
  EXEC_OUTPUT: "Exec Output",
  COMMAND: "Command",
  ERROR: "Fault",
  COGNITIVE_LOG: "Cognitive Log",
  FILE_CONTENT: "File Read",
  FILESYSTEM: "Filesystem",
  NEURAL: "Neural Command",
  NEXUS_PACKET: "Nexus Packet",
  GENERIC: "Nexus Packet",
};

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function basename(value: string) {
  return value.replace(/\\/g, "/").split("/").filter(Boolean).pop() || value;
}

function formatPayloadValue(value: unknown) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return truncate(value.replace(/\s+/g, " "), 28);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") return `object(${Object.keys(value as Record<string, unknown>).length})`;
  return truncate(String(value), 28);
}

export function getNexusLogLabel(type: string) {
  return NEXUS_LOG_LABELS[type] || titleCase(type || "NEXUS_PACKET");
}

export function getNexusLogSignal(type: string) {
  return getNexusLogLabel(type).replace(/\s+/g, "_").toUpperCase();
}

export function classifyNexusPacket(payload: unknown, headerType?: string, fallbackType = "NEXUS_PACKET") {
  if (headerType && headerType !== "GENERIC") return headerType;

  if (Array.isArray(payload)) return "FILESYSTEM_TREE";
  if (!payload || typeof payload !== "object") return fallbackType;

  const record = payload as Record<string, unknown>;
  if ("cpu_load" in record || "ram_used" in record || "cpu_temp" in record) return "HARDWARE_PULSE";
  if (Array.isArray(record.nodes) && "total_threads" in record) return "PROCESS_GRAPH";
  if (Array.isArray(record.tree) || ("path" in record && "depth" in record)) return "FILESYSTEM_TREE";
  if ("content" in record && ("path" in record || "filepath" in record)) return "FILE_READ";
  if (record.status === "success" && "bytes" in record) return "FILE_WRITE";
  if ("output" in record && "exitCode" in record) return "EXEC_OUTPUT";
  if ("command" in record || "cmd" in record) return "COMMAND";

  return fallbackType;
}

export function summarizeNexusPayload(payload: unknown, maxLength = 100) {
  if (payload === null || payload === undefined) return "No payload";
  if (typeof payload === "string") return truncate(payload.replace(/\s+/g, " "), maxLength);
  if (Array.isArray(payload)) return `Mirror roots: ${payload.length}`;
  if (typeof payload !== "object") return formatPayloadValue(payload);

  const record = payload as Record<string, unknown>;
  if ("cpu_load" in record || "ram_used" in record || "cpu_temp" in record) {
    return `CPU ${formatPayloadValue(record.cpu_load)}% // RAM ${formatPayloadValue(record.ram_used)}% // TEMP ${formatPayloadValue(record.cpu_temp)}`;
  }
  if (Array.isArray(record.nodes) && "total_threads" in record) {
    // Process-graph packets now ship richer per-node payloads (windowTitle, command,
    // mem, parentPid). Surface the top hitter by CPU so the log entry says something
    // specific instead of just a count — e.g. "12 procs · top msedge 47% (X — GitHub)".
    const nodes = (record.nodes as Array<Record<string, unknown>>);
    const top = [...nodes].sort((a, b) => Number(b.usage || 0) - Number(a.usage || 0))[0];
    const procCount = nodes.length;
    const totalThreads = formatPayloadValue(record.total_threads);
    if (!top) return `${procCount} procs · ${totalThreads} threads`;
    const topName = String(top.name || top.id || "?");
    const topUsage = typeof top.usage === "number" ? `${top.usage.toFixed(1)}%` : "?";
    const topTitle = typeof top.windowTitle === "string" && top.windowTitle
      ? ` — ${truncate(top.windowTitle, 40)}`
      : "";
    return `${procCount} procs · top ${topName} ${topUsage}${topTitle} · ${totalThreads}thr`;
  }
  if (Array.isArray(record.tree)) {
    return `Mirror roots: ${record.tree.length} // ${formatPayloadValue(record.path)}`;
  }
  if ("content" in record && ("path" in record || "filepath" in record)) {
    const target = String(record.path || record.filepath || "Unknown");
    return `Read ${basename(target)} // ${String(record.content ?? "").length} chars`;
  }
  if ("path" in record && "bytes" in record) {
    return `${basename(String(record.path))} // ${formatPayloadValue(record.bytes)} bytes`;
  }

  const keys = Object.keys(record);
  if (keys.length === 0) return "Empty payload";

  const keySummary = `Keys: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ", ..." : ""}`;
  const preview = keys
    .slice(0, 3)
    .map((key) => `${key}=${formatPayloadValue(record[key])}`)
    .join(" // ");

  return truncate(preview ? `${keySummary} // ${preview}` : keySummary, maxLength);
}
