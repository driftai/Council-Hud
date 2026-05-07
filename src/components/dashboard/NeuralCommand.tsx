
"use client";

import { useState, useRef, useEffect } from "react";
import { DashboardCard } from "./DashboardCard";
import { Terminal, Send, Sparkles, AlertCircle, Brain, Command, Trash2, X } from "lucide-react";
import { useNexus } from "@/providers/NexusProvider";
import { nexusCommand } from "@/ai/flows/nexus-commander";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ChatMessage = {
  role: 'user' | 'model';
  content: string;
  command?: string;
  timestamp: number;
};

type ReadFileSnapshot = {
  path: string;
  content: string;
};

type FileEditSnapshot = {
  path: string;
  content: string | null;
  existed: boolean;
  timestamp: number;
};

type PendingDelete = {
  path: string;
  message: string;
};

type FileTreeNode = {
  name?: string;
  path?: string;
  type?: string;
  children?: FileTreeNode[];
};

function normalizePathSeparators(path: string) {
  return path.replace(/\\/g, "/");
}

function getFileName(path: string) {
  return normalizePathSeparators(path).split("/").filter(Boolean).pop() || path;
}

function stripFileContentWrapper(value: string) {
  const trimmed = value.trim();
  const tripleQuoted = trimmed.match(/^"""([\s\S]*)"""$/);
  if (tripleQuoted) return tripleQuoted[1].trim();
  return trimmed;
}

function wantsRedaction(directive: string) {
  const text = directive.toLowerCase();
  return /\b(redact|redacted|blur|blurr|mask|hide|censor|sanitize)\b/.test(text)
    || /\bbur\s+out\b/.test(text)
    || (/\b(important|importnat|sensitive|secret|private)\s+(info|information)\b/.test(text)
      && /\b(out|hide|blur|redact|mask|remove)\b/.test(text));
}

function wantsPlainOutput(directive: string) {
  const text = directive.toLowerCase();
  return /\b(unredacted|no redaction|without redaction|plain extract|raw extract|show the sensitive|show sensitive)\b/.test(text);
}

function wantsExplicitOpen(directive: string) {
  return /\b(open|pull up)\b/i.test(directive);
}

function wantsDeleteWithoutConfirmation(directive: string) {
  const text = directive.toLowerCase();
  return /\b(go ahead|without confirmation|without asking|no confirmation|no need.*loop|do it without me|delete it now|just delete)\b/.test(text);
}

function wantsEditDirective(directive: string) {
  return /\b(edit|replace|change|rewrite|update|modify|write|create|make|new file|save)\b/i.test(directive);
}

function wantsDeleteDirective(directive: string) {
  return /\b(delete|remove|trash|erase)\b/i.test(directive);
}

function wantsRevertDirective(directive: string) {
  return /\b(revert|undo|roll back|restore previous|previous state|back to where)\b/i.test(directive);
}

function wantsSessionFirstQuestion(directive: string) {
  return /\bwhat did i ask\b.*\bfirst\b|\bfirst\b.*\basked\b.*\bsession\b/i.test(directive);
}

function shouldRedactForTurn(rootDirective: string, history: ChatMessage[]) {
  if (wantsPlainOutput(rootDirective)) return false;
  if (wantsExplicitOpen(rootDirective) && !wantsRedaction(rootDirective)) return false;
  if (wantsRedaction(rootDirective)) return true;

  const recentUserText = history
    .filter((message) => message.role === "user")
    .slice(-4)
    .map((message) => message.content)
    .join("\n");
  const currentContinuesFileRequest = /\b(it|that|file|read|info|content|send|again|dont open|don't open)\b/i.test(rootDirective);
  return currentContinuesFileRequest && wantsRedaction(recentUserText) && !wantsPlainOutput(recentUserText);
}

function redactSensitiveContent(value: string) {
  return value
    .replace(/\bnvapi-[A-Za-z0-9_-]+/g, "[REDACTED_NVIDIA_API_KEY]")
    .replace(/(api\s*key\s*\d*\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(token\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(secret\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(password\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(codex\s+resume\s+)[A-Za-z0-9-]+/gi, "$1[REDACTED_SESSION]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[REDACTED_ID]")
    .replace(/\bC:[/\\]Users[/\\][^/\\\r\n]+/gi, "C:/Users/[REDACTED_USER]");
}

function parseMaybeJsonMessage(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  const attempts = [
    trimmed,
    trimmed.replace(/\\(?!["\\/bfnrtu])/g, "/"),
  ];

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      continue;
    }
  }

  return null;
}

function formatObjectValue(value: unknown): string {
  if (typeof value === "string") return normalizePathSeparators(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function humanizeObjectMessage(value: Record<string, unknown>) {
  if (typeof value.file_content === "string") {
    return `File content:\n\n${stripFileContentWrapper(value.file_content)}`;
  }

  if (typeof value.codeword === "string") {
    return `Codeword: ${stripFileContentWrapper(value.codeword)}`;
  }

  if (typeof value.error === "string") {
    return value.status ? `${value.error}\nStatus: ${formatObjectValue(value.status)}` : value.error;
  }

  if (typeof value.description === "string" || typeof value.visible === "boolean") {
    const description = typeof value.description === "string"
      ? value.description
      : value.visible
        ? "Yes, it is visible."
        : "No, it is not visible.";
    const path = typeof value.path === "string" ? `\nPath: ${normalizePathSeparators(value.path)}` : "";
    return `${description}${path}`;
  }

  if (typeof value.action === "string" && typeof value.file_path === "string") {
    return `Reading ${getFileName(value.file_path)}...\nPath: ${normalizePathSeparators(value.file_path)}`;
  }

  return Object.entries(value)
    .map(([key, entry]) => `${key.replace(/_/g, " ")}: ${formatObjectValue(entry)}`)
    .join("\n");
}

function humanizeModelMessage(message: string, shouldRedact = false) {
  const parsed = parseMaybeJsonMessage(message);
  let display: string;
  if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
    display = humanizeObjectMessage(parsed as Record<string, unknown>);
  } else if (Array.isArray(parsed)) {
    display = parsed.map((entry) => formatObjectValue(entry)).join("\n");
  } else {
    display = normalizePathSeparators(message);
  }

  return shouldRedact ? redactSensitiveContent(display) : display;
}

function wantsInspectorOpen(directive: string, payload: Record<string, any>, shouldRedact = false) {
  const text = directive.toLowerCase();
  if (/\b(don't|dont|do not|not|without)\s+open/.test(text)) return false;
  if (/\b(here|in chat|in the chat)\b/.test(text) && !wantsExplicitOpen(directive)) return false;
  if (shouldRedact) return false;
  const asksForContent = /\b(read|tell me|what.*say|content|contents|code\s*word|codeword)\b/.test(text);
  const explicitOpen = wantsExplicitOpen(directive);
  if (asksForContent && !explicitOpen) return false;
  const directiveWantsOpen =
    explicitOpen ||
    (!asksForContent && /\b(show|view|display)\b/.test(text));

  const payloadSignals = [
    payload.openInspector,
    payload.open_inspector,
    payload.viewer,
    payload.mode,
    payload.action,
  ].map((value) => String(value ?? "").toLowerCase());

  return (
    payload.openInspector === true ||
    payload.open_inspector === true ||
    payloadSignals.some((value) => /\b(open|show|view|display|inspector)\b/.test(value)) ||
    directiveWantsOpen
  );
}

function isCodewordDirective(directive: string) {
  return /\bcode\s*word\b|\bcodeword\b/i.test(directive);
}

function extractCodeword(content: string) {
  const cleaned = stripFileContentWrapper(content);
  const labeled = cleaned.match(/code\s*word\s*[:=-]\s*["']?(.+?)["']?\s*$/im);
  if (labeled) return stripFileContentWrapper(labeled[1]).replace(/^["']|["']$/g, "");

  const firstMeaningfulLine = cleaned.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return (firstMeaningfulLine || cleaned || "(empty file)").replace(/^["']|["']$/g, "");
}

function shouldAnswerDirectlyFromRead(directive: string, shouldRedact = false) {
  return shouldRedact
    || /\b(read|tell me|what.*say|what is|what's|content|contents|code\s*word|codeword)\b/i.test(directive);
}

function wantsMultipleFileRead(directive: string) {
  const text = directive.toLowerCase();
  return /\b(both|all|each|files|and also|also|then|test.*info|info.*test)\b/.test(text)
    || (/\band\b/.test(text) && /\b(file|files|txt|text)\b/.test(text));
}

function isFileReadDirective(directive: string) {
  return /\b(read|what.*in|what.*says?|tell me|content|contents)\b/i.test(directive);
}

function flattenFileTree(nodes: unknown): FileTreeNode[] {
  if (!Array.isArray(nodes)) return [];

  const flattened: FileTreeNode[] = [];
  const visit = (node: FileTreeNode) => {
    flattened.push(node);
    if (Array.isArray(node.children)) {
      node.children.forEach(visit);
    }
  };

  nodes.forEach((node) => {
    if (node && typeof node === "object") visit(node as FileTreeNode);
  });

  return flattened;
}

function isFolderNode(node: FileTreeNode) {
  return node.type === "folder" || node.type === "directory";
}

function isFileNode(node: FileTreeNode) {
  return node.type === "file";
}

function fileNameMatchesDirective(name: string, directive: string) {
  const normalizedName = name.toLowerCase();
  const normalizedDirective = directive.toLowerCase();
  const stem = normalizedName.replace(/\.[^.]+$/, "");

  return normalizedDirective.includes(normalizedName)
    || normalizedDirective.includes(stem)
    || (stem === "info" && /\binfo\b/.test(normalizedDirective))
    || (stem === "test" && /\btest\b/.test(normalizedDirective));
}

function getFilesUnderFolder(folder: FileTreeNode) {
  const children = Array.isArray(folder.children) ? folder.children : [];
  return children
    .filter((child) => isFileNode(child) && typeof child.path === "string")
    .map((child) => normalizePathSeparators(child.path!));
}

function getRequestedFolderNames(text: string) {
  const names = new Set<string>();
  if (/\bnotes?\b/i.test(text)) names.add("notes");

  for (const match of text.matchAll(/\b(?:in|inside|from)\s+(?:the\s+)?([A-Za-z0-9_. -]+?)\s+folder\b/gi)) {
    const name = match[1]?.trim().toLowerCase();
    if (name) names.add(name.replace(/\s+/g, " "));
  }

  return Array.from(names);
}

function pathIsUnderFolder(pathValue: string, folderName: string) {
  return normalizePathSeparators(pathValue).toLowerCase().split("/").includes(folderName.toLowerCase());
}

function getFolderNode(nodes: FileTreeNode[], folderName: string) {
  return nodes.find((node) => isFolderNode(node) && String(node.name || "").toLowerCase() === folderName.toLowerCase());
}

function shouldUseHistoryFolderContext(directive: string) {
  return /\b(it|that|those|both|all|each|them|inside it|the folder|the files|there|ther)\b/i.test(directive)
    || !/\b[\w.-]+\.[A-Za-z0-9]{1,8}\b/.test(directive);
}

function getRelevantFolderNames(directive: string, history: ChatMessage[]) {
  const currentFolderNames = getRequestedFolderNames(directive);
  if (currentFolderNames.length > 0) return currentFolderNames;
  return shouldUseHistoryFolderContext(directive)
    ? getRequestedFolderNames(history.slice(-8).map((message) => message.content).join("\n"))
    : [];
}

function wantsFolderInventory(directive: string, history: ChatMessage[]) {
  const text = directive.toLowerCase();
  if (wantsEditDirective(directive) || wantsDeleteDirective(directive) || wantsExplicitOpen(directive)) return false;
  if (/\b(read|what.*says?|content|contents|code\s*word|codeword)\b/i.test(directive)) return false;

  const folderNames = getRelevantFolderNames(directive, history);
  const asksFolderQuestion = /\b(can you see|see|visible|exists?|is there|find|what files|which files|list|files are|inside|there|ther)\b/.test(text);
  const correctionToListFiles = /\bshould have said\b.*\bfiles\b|\bwhat files are (?:there|ther)\b/.test(text);

  return folderNames.length > 0 && (asksFolderQuestion || correctionToListFiles);
}

function buildFolderInventoryResponse(directive: string, history: ChatMessage[], fileTree: unknown) {
  const nodes = flattenFileTree(fileTree);
  const folderNames = getRelevantFolderNames(directive, history);
  const requestedName = folderNames[0];
  if (!requestedName) return null;

  const folder = getFolderNode(nodes, requestedName);
  if (!folder) {
    return `I do not see a ${requestedName} folder in the current Recursive Mirror tree.`;
  }

  const displayName = folder.name || requestedName;
  const wantsPath = /\b(path|where|location|located)\b/i.test(directive);
  const pathLine = wantsPath && folder.path ? `\nPath: ${redactSensitiveContent(normalizePathSeparators(folder.path))}` : "";
  const children = Array.isArray(folder.children) ? folder.children : [];
  const childFiles = children
    .filter((child) => isFileNode(child))
    .map((child) => child.name || (child.path ? getFileName(child.path) : "unnamed file"))
    .filter(Boolean);
  const childFolders = children
    .filter((child) => isFolderNode(child))
    .map((child) => child.name || (child.path ? getFileName(child.path) : "unnamed folder"))
    .filter(Boolean);
  const folderPath = folder.path ? normalizePathSeparators(folder.path).replace(/\/+$/, "") : "";
  const fallbackFiles = folderPath
    ? nodes
        .filter((node) => isFileNode(node) && typeof node.path === "string")
        .filter((node) => normalizePathSeparators(node.path!).startsWith(`${folderPath}/`))
        .map((node) => node.name || getFileName(node.path!))
        .filter(Boolean)
    : [];
  const directFiles = childFiles.length > 0 ? childFiles : fallbackFiles;
  const directFolders = childFolders;

  const fileLines = directFiles.length > 0
    ? directFiles.map((file) => `- ${file}`).join("\n")
    : "- No direct files shown in the current tree snapshot.";
  const folderLines = directFolders.length > 0
    ? `\nFolders:\n${directFolders.map((folderName) => `- ${folderName}`).join("\n")}`
    : "";

  return `Yes, I can see the ${displayName} folder.${pathLine}\nFiles:\n${fileLines}${folderLines}`;
}

function resolveFilePathCandidate(pathValue: string, directive: string, history: ChatMessage[], fileTree: unknown, workingDirectory = "") {
  const normalized = normalizePathSeparators(pathValue).replace(/\/+$/, "");
  if (!normalized) return "";

  const nodes = flattenFileTree(fileTree);
  const fileNodes = nodes.filter((node) => isFileNode(node) && typeof node.path === "string");
  const folderNames = getRelevantFolderNames(directive, history);
  const lowerCandidate = normalized.toLowerCase();
  const candidateName = getFileName(normalized).toLowerCase();

  const exact = fileNodes.find((file) => normalizePathSeparators(file.path!).toLowerCase() === lowerCandidate);
  if (exact?.path) return normalizePathSeparators(exact.path);

  const matchingFiles = fileNodes.filter((file) => {
    const name = String(file.name || getFileName(file.path!)).toLowerCase();
    const path = normalizePathSeparators(file.path!).toLowerCase();
    const nameMatches = name === candidateName || path.endsWith(`/${candidateName}`);
    if (!nameMatches) return false;
    if (folderNames.length === 0) return true;
    return folderNames.some((folderName) => pathIsUnderFolder(path, folderName));
  });
  if (matchingFiles[0]?.path) return normalizePathSeparators(matchingFiles[0].path);

  const isAbsolute = /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/");
  if (isAbsolute) return normalized;

  if (folderNames.length > 0) {
    const folder = getFolderNode(nodes, folderNames[0]);
    if (folder?.path) {
      const parts = normalized.split("/");
      const folderIndex = parts.findIndex((part) => part.toLowerCase() === folderNames[0].toLowerCase());
      const suffix = folderIndex >= 0 ? parts.slice(folderIndex + 1).join("/") : normalized;
      return `${normalizePathSeparators(folder.path).replace(/\/+$/, "")}/${suffix}`;
    }
  }

  return workingDirectory
    ? `${normalizePathSeparators(workingDirectory).replace(/\/+$/, "")}/${normalized}`
    : normalized;
}

function constrainPathsToRequestedFolder(paths: string[], directive: string, history: ChatMessage[], fileTree: unknown) {
  const folderNames = getRelevantFolderNames(directive, history);
  if (folderNames.length === 0) return paths;

  const scoped = paths.filter((pathValue) => folderNames.some((folderName) => pathIsUnderFolder(pathValue, folderName)));
  if (scoped.length > 0) return scoped;

  const nodes = flattenFileTree(fileTree);
  const fallback = new Set<string>();
  for (const folderName of folderNames) {
    const folder = getFolderNode(nodes, folderName);
    if (folder) getFilesUnderFolder(folder).forEach((pathValue) => fallback.add(pathValue));
  }

  return fallback.size > 0 ? Array.from(fallback) : paths;
}

function inferReadPathsFromContext(directive: string, history: ChatMessage[], fileTree: unknown) {
  if (!isFileReadDirective(directive)) return [];

  const nodes = flattenFileTree(fileTree);
  const fileNodes = nodes.filter((node) => isFileNode(node) && typeof node.path === "string");
  const recentText = history
    .slice(-8)
    .map((message) => message.content)
    .join("\n");
  const combinedText = `${directive}\n${recentText}`;
  const inferred = new Set<string>();

  for (const file of fileNodes) {
    if (typeof file.name === "string" && fileNameMatchesDirective(file.name, directive)) {
      inferred.add(normalizePathSeparators(file.path!));
    }
  }

  const mentionsNotes = /\bnotes?\b/i.test(combinedText);
  const asksForFolderFiles = wantsMultipleFileRead(directive) || /\bfiles?\b/i.test(directive);
  if (mentionsNotes && asksForFolderFiles) {
    const notesFolder = nodes.find((node) => isFolderNode(node) && String(node.name || "").toLowerCase() === "notes");
    if (notesFolder) {
      getFilesUnderFolder(notesFolder).forEach((path) => inferred.add(path));
    }
    for (const file of fileNodes) {
      const path = normalizePathSeparators(file.path!);
      if (/(^|\/)notes\//i.test(path)) inferred.add(path);
    }
    if (inferred.size === 0 && fileNodes.length > 0 && fileNodes.length <= 5) {
      fileNodes
        .filter((file) => /\.txt$/i.test(String(file.name || file.path || "")))
        .forEach((file) => inferred.add(normalizePathSeparators(file.path!)));
    }
  }

  const explicitTxtNames = Array.from(directive.matchAll(/\b[\w.-]+\.txt\b/gi)).map((match) => match[0].toLowerCase());
  if (explicitTxtNames.length > 0) {
    for (const file of fileNodes) {
      const fileName = String(file.name || "").toLowerCase();
      if (explicitTxtNames.includes(fileName)) inferred.add(normalizePathSeparators(file.path!));
    }
  }

  return Array.from(inferred).slice(0, 5);
}

function getReadFilePaths(payload: Record<string, any>) {
  const candidates = [
    payload.path,
    payload.file_path,
    payload.filePath,
    ...(Array.isArray(payload.paths) ? payload.paths : []),
    ...(Array.isArray(payload.files) ? payload.files : []),
  ];

  const seen = new Set<string>();
  return candidates
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => normalizePathSeparators(value.trim()))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function firstPayloadString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || "";
}

function getWriteFilePath(payload: Record<string, any>, fallbackPath = "") {
  return firstPayloadString(payload.path, payload.file_path, payload.filePath, payload.filepath, fallbackPath);
}

function getWriteFileContent(payload: Record<string, any>) {
  for (const value of [payload.content, payload.file_content, payload.fileContent, payload.text, payload.body]) {
    if (typeof value === "string") return value;
  }
  return "";
}

function payloadHasWriteContent(payload: Record<string, any>) {
  return [payload.content, payload.file_content, payload.fileContent, payload.text, payload.body]
    .some((value) => typeof value === "string");
}

function getDeleteFilePath(payload: Record<string, any>, fallbackPath = "") {
  return firstPayloadString(payload.path, payload.file_path, payload.filePath, payload.filepath, fallbackPath);
}

function getFirstUserQuestion(history: ChatMessage[]) {
  return history.find((message) => message.role === "user")?.content || "";
}

function buildSessionFirstQuestionResponse(firstQuestion: string) {
  if (!firstQuestion) return "I do not have an earlier user request in this page session.";
  return `The first thing you asked in this page session was:\n\n${firstQuestion}`;
}

function buildFileWriteResponse(path: string, content: string, hadSnapshot: boolean) {
  const rollback = hadSnapshot
    ? "Previous content is cached for this page session, so you can ask me to revert it before reload."
    : "This file did not have a readable previous state cached.";
  return `Saved ${getFileName(path)}.\nPath: ${normalizePathSeparators(path)}\nBytes: ${content.length}\n${rollback}`;
}

function buildFileDeleteResponse(path: string) {
  return `Deleted ${getFileName(path)}.\nPath: ${normalizePathSeparators(path)}\nPrevious content is cached for this page session when it was readable.`;
}

function buildDeleteConfirmationMessage(path: string) {
  return `Deletion requires confirmation.\n\nTarget: ${normalizePathSeparators(path)}\n\nApprove this dialog to delete it, or cancel to leave the file untouched.`;
}

function cleanReplacementTerm(value: string) {
  return value.trim().replace(/^["'`]+|["'`.,!?]+$/g, "").trim();
}

function parseSimpleReplacementDirective(directive: string) {
  const patterns = [
    /\breplace\s+(?:the\s+word\s+)?["'`]?(.+?)["'`]?\s+with\s+["'`]?(.+?)["'`]?(?=\s+(?:in|inside|from|on)\b|$|[.?!])/i,
    /\b(?:change|update|modify)\s+(?:the\s+word\s+)?["'`]?(.+?)["'`]?\s+(?:to|into)\s+["'`]?(.+?)["'`]?(?=\s+(?:in|inside|from|on)\b|$|[.?!])/i,
  ];

  for (const pattern of patterns) {
    const match = directive.match(pattern);
    const from = cleanReplacementTerm(match?.[1] || "");
    const to = cleanReplacementTerm(match?.[2] || "");
    if (from && to && from !== to) return { from, to };
  }

  return null;
}

function tryBuildSimpleReplacementContent(directive: string, content: string) {
  const replacement = parseSimpleReplacementDirective(directive);
  if (!replacement || !content.includes(replacement.from)) return null;
  return {
    content: content.split(replacement.from).join(replacement.to),
    from: replacement.from,
    to: replacement.to,
  };
}

function parseCodewordAssignment(directive: string) {
  const patterns = [
    /\bcode\s*word\b.*?\b(?:to be|to|as|=)\s+["'`]?(.+?)["'`]?(?=\s+(?:in|inside|from|on)\b|$|[.?!])/i,
    /\bcodeword\b.*?\b(?:to be|to|as|=)\s+["'`]?(.+?)["'`]?(?=\s+(?:in|inside|from|on)\b|$|[.?!])/i,
  ];

  for (const pattern of patterns) {
    const match = directive.match(pattern);
    const value = cleanReplacementTerm(match?.[1] || "");
    if (value && !/^code\s*word\s*:?\s*$/i.test(value)) return value;
  }

  return null;
}

function tryBuildCodewordReplacementContent(directive: string, content: string) {
  const newCodeword = parseCodewordAssignment(directive);
  if (!newCodeword) return null;

  const cleaned = stripFileContentWrapper(content);
  const newline = cleaned.includes("\r\n") ? "\r\n" : "\n";
  const lines = cleaned.split(/\r?\n/);
  const labeledIndex = lines.findIndex((line) => /^\s*code\s*word\s*[:=-]/i.test(line));

  if (labeledIndex >= 0) {
    const prefix = lines[labeledIndex].match(/^(\s*code\s*word\s*[:=-]\s*)/i)?.[1] || "Codeword: ";
    lines[labeledIndex] = `${prefix}${newCodeword}`;
    return { content: lines.join(newline), codeword: newCodeword };
  }

  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex >= 0) {
    lines[firstContentIndex] = `Codeword: ${newCodeword}`;
    return { content: lines.join(newline), codeword: newCodeword };
  }

  return { content: `Codeword: ${newCodeword}`, codeword: newCodeword };
}

function buildFileReadResponse(directive: string, path: string, content: string, openedInspector: boolean, shouldRedact = false) {
  const fileName = getFileName(path);
  const displayPath = normalizePathSeparators(path);
  const cleaned = stripFileContentWrapper(content);

  if (openedInspector && !shouldRedact) {
    return `Opened ${fileName} in Remote_Inspector.\nPath: ${displayPath}`;
  }

  if (shouldRedact) {
    return `I read ${fileName}. Redacted important information:\n\n${redactSensitiveContent(cleaned) || "(empty file)"}`;
  }

  if (isCodewordDirective(directive)) {
    return `The codeword in ${fileName} is: ${extractCodeword(content)}.`;
  }

  return `I read ${fileName}. It says:\n\n${cleaned || "(empty file)"}`;
}

function isEmptyBridgeResponse(message: string) {
  return /Bridge Offline:\s*Empty response from Neural Bridge/i.test(message);
}

export function NeuralCommand() {
  const nexus = useNexus();
  const { state, knowledgeGraph, fileTree, systemHealth, url, addManualLog, fileContent, workingDirectory } = nexus;
  
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastAgentReadFile, setLastAgentReadFile] = useState<ReadFileSnapshot | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileEditCacheRef = useRef<Map<string, FileEditSnapshot>>(new Map());
  const lastMutationPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const appendModelMessage = (
    history: ChatMessage[],
    content: string,
    command?: string,
  ) => {
    const nextHistory = [
      ...history,
      {
        role: "model" as const,
        content,
        command,
        timestamp: Date.now(),
      },
    ];
    setMessages([...nextHistory]);
    return nextHistory;
  };

  const resolveCommandPath = (
    pathValue: string,
    directive: string,
    history: ChatMessage[],
  ) => resolveFilePathCandidate(pathValue, directive, history, fileTree, workingDirectory);

  const cacheFileBeforeMutation = async (path: string) => {
    const normalizedPath = normalizePathSeparators(path);
    const cacheKey = normalizedPath.toLowerCase();
    const existingSnapshot = fileEditCacheRef.current.get(cacheKey);
    if (existingSnapshot) return existingSnapshot;

    try {
      const content = await nexus.readFile(normalizedPath, { openInspector: false });
      const snapshot: FileEditSnapshot = {
        path: normalizedPath,
        content: content ?? "",
        existed: true,
        timestamp: Date.now(),
      };
      fileEditCacheRef.current.set(cacheKey, snapshot);
      addManualLog("ROLLBACK_CACHE", { path: normalizedPath, state: "captured" });
      return snapshot;
    } catch {
      const snapshot: FileEditSnapshot = {
        path: normalizedPath,
        content: null,
        existed: false,
        timestamp: Date.now(),
      };
      fileEditCacheRef.current.set(cacheKey, snapshot);
      addManualLog("ROLLBACK_CACHE", { path: normalizedPath, state: "new_or_unreadable" });
      return snapshot;
    }
  };

  const executeWriteFile = async (path: string, content: string) => {
    const snapshot = await cacheFileBeforeMutation(path);
    await nexus.writeFile(path, content);
    lastMutationPathRef.current = path;
    setLastAgentReadFile({ path, content });
    return snapshot;
  };

  const executeDeleteFile = async (path: string) => {
    await cacheFileBeforeMutation(path);
    await nexus.deleteFile(path);
    lastMutationPathRef.current = path;
    setLastAgentReadFile((prev) => prev?.path === path ? null : prev);
  };

  const handleRevertRequest = async (input: string, history: ChatMessage[]) => {
    const inferredPath = inferReadPathsFromContext(input, history, fileTree)[0];
    const cachedSnapshots = Array.from(fileEditCacheRef.current.values());
    const newestCachedPath = cachedSnapshots.sort((a, b) => b.timestamp - a.timestamp)[0]?.path || "";
    const fallbackPath = inferredPath || lastAgentReadFile?.path || fileContent?.path || lastMutationPathRef.current || newestCachedPath || "";
    const resolvedPath = fallbackPath ? resolveCommandPath(fallbackPath, input, history) : "";
    const cacheKey = normalizePathSeparators(resolvedPath).toLowerCase();
    const snapshot = resolvedPath ? fileEditCacheRef.current.get(cacheKey) : undefined;

    if (!resolvedPath || !snapshot) {
      return appendModelMessage(
        history,
        "I do not have a cached previous state for that file in this page session.",
      );
    }

    if (snapshot.existed && snapshot.content !== null) {
      await nexus.writeFile(snapshot.path, snapshot.content);
      lastMutationPathRef.current = snapshot.path;
      setLastAgentReadFile({ path: snapshot.path, content: snapshot.content });
      return appendModelMessage(
        history,
        `Restored ${getFileName(snapshot.path)} to its cached previous state.\nPath: ${normalizePathSeparators(snapshot.path)}`,
        "WRITE_FILE",
      );
    }

    if (wantsDeleteWithoutConfirmation(input)) {
      await executeDeleteFile(snapshot.path);
      return appendModelMessage(history, buildFileDeleteResponse(snapshot.path), "DELETE_FILE");
    }

    setPendingDelete({
      path: snapshot.path,
      message: `Reverting this session-created file requires deleting it.\n\nTarget: ${normalizePathSeparators(snapshot.path)}`,
    });
    return appendModelMessage(
      history,
      buildDeleteConfirmationMessage(snapshot.path),
      "DELETE_FILE",
    );
  };

  const confirmPendingDelete = async () => {
    if (!pendingDelete) return;
    const deletePath = pendingDelete.path;
    setPendingDelete(null);
    setIsLoading(true);
    try {
      await executeDeleteFile(deletePath);
      setMessages((prev) => [
        ...prev,
        {
          role: "model",
          content: buildFileDeleteResponse(deletePath),
          command: "DELETE_FILE",
          timestamp: Date.now(),
        },
      ]);
    } catch (error: any) {
      const errorMsg = `Delete failed: ${error.message || "Unknown error"}`;
      setMessages((prev) => [...prev, { role: "model", content: errorMsg, timestamp: Date.now() }]);
      addManualLog("ERROR", errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Atomic Neural Handshake V110
   * Uses a local 'history' variable to ensure the AI receives 
   * retrieved results in the SAME operational flow.
   */
  const processAiTurn = async (
    input: string,
    historySeed: ChatMessage[],
    isSilent: boolean = false,
    rootDirective: string = input,
    readFileOverride: ReadFileSnapshot | null = null,
    readDepth: number = 0,
    redactionOverride?: boolean
  ) => {
    let localHistory = [...historySeed];
    
    if (!isSilent) {
      const userMsg: ChatMessage = { role: 'user', content: input, timestamp: Date.now() };
      localHistory.push(userMsg);
      setMessages([...localHistory]);
    }

    if (!isSilent && wantsSessionFirstQuestion(input)) {
      appendModelMessage(localHistory, buildSessionFirstQuestionResponse(getFirstUserQuestion(historySeed) || input));
      return;
    }

    if (!isSilent && wantsFolderInventory(input, localHistory)) {
      const inventoryResponse = buildFolderInventoryResponse(input, localHistory, fileTree);
      if (inventoryResponse) {
        addManualLog("FILESYSTEM_TREE", `Answered folder inventory without reading file contents`);
        appendModelMessage(localHistory, inventoryResponse);
        return;
      }
    }

    if (!isSilent && wantsRevertDirective(input)) {
      setIsLoading(true);
      try {
        await handleRevertRequest(input, localHistory);
      } catch (error: any) {
        const errorMsg = `Revert failed: ${error.message || "Unknown error"}`;
        setMessages(prev => [...prev, { role: 'model', content: errorMsg, timestamp: Date.now() }]);
        addManualLog("ERROR", errorMsg);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    if (!isSilent) addManualLog("NEURAL", `Analyzing directive: "${input}"`);
    const shouldRedactTurn = redactionOverride ?? shouldRedactForTurn(rootDirective, localHistory);

    try {
      const conversationHistory = localHistory.slice(-15).map(m => ({
        role: m.role,
        content: m.content
      }));
      const contextReadFile = readFileOverride || lastAgentReadFile || fileContent || undefined;

      let result = await nexusCommand({
        prompt: input,
        history: conversationHistory,
        context: {
          processes: knowledgeGraph?.nodes || [],
          fileTree: fileTree || [],
          systemHealth: systemHealth || {},
          currentUrl: url,
          workingDirectory: workingDirectory || "C:/",
          lastReadFile: contextReadFile ? { path: contextReadFile.path, content: contextReadFile.content } : undefined
        }
      });
      const inferredReadPaths = inferReadPathsFromContext(rootDirective, localHistory, fileTree);

      if (isEmptyBridgeResponse(result.message) && inferredReadPaths.length > 0 && shouldAnswerDirectlyFromRead(rootDirective, shouldRedactTurn)) {
        result = {
          thought: "Local fallback recovered file-read intent from visible file tree context.",
          command: "READ_FILE",
          payload: inferredReadPaths.length > 1 ? { paths: inferredReadPaths } : { path: inferredReadPaths[0] },
          message: inferredReadPaths.length > 1
            ? `Reading ${inferredReadPaths.length} files from local context.`
            : `Reading ${getFileName(inferredReadPaths[0])} from local context.`,
        };
      } else if (result.command === "NONE" && inferredReadPaths.length > 0 && shouldAnswerDirectlyFromRead(rootDirective, shouldRedactTurn)) {
        result = {
          thought: "Local fallback promoted visible file-read intent to READ_FILE.",
          command: "READ_FILE",
          payload: inferredReadPaths.length > 1 ? { paths: inferredReadPaths } : { path: inferredReadPaths[0] },
          message: inferredReadPaths.length > 1
            ? `Reading ${inferredReadPaths.length} requested files.`
            : `Reading ${getFileName(inferredReadPaths[0])}.`,
        };
      }

      const modelMsg: ChatMessage = {
        role: 'model',
        content: humanizeModelMessage(result.message, shouldRedactTurn),
        command: result.command !== "NONE" ? result.command : undefined,
        timestamp: Date.now()
      };
      
      localHistory = [...localHistory, modelMsg];
      setMessages([...localHistory]);

      if (result.thought) addManualLog("NEURAL", result.thought);
      const allowSilentFollowupRead = result.command === "READ_FILE"
        && wantsMultipleFileRead(rootDirective)
        && readDepth < 4;
      const allowSilentWrite = result.command === "WRITE_FILE"
        && wantsEditDirective(rootDirective)
        && readDepth < 4;
      const allowSilentDelete = result.command === "DELETE_FILE"
        && wantsDeleteDirective(rootDirective)
        && readDepth < 4;
      if (isSilent && result.command !== "NONE" && !allowSilentFollowupRead && !allowSilentWrite && !allowSilentDelete) {
        addManualLog("SECURITY", `Suppressed ${result.command} from file-derived AI context`);
        return;
      }

      // --- SYNCHRONOUS HANDSHAKE LOOP ---
      if (result.command === "READ_FILE") {
        const readPathSet = new Set(
          getReadFilePaths(result.payload || {})
            .map((path) => resolveCommandPath(path, rootDirective, localHistory))
            .filter(Boolean)
        );
        if (wantsMultipleFileRead(rootDirective)) {
          inferredReadPaths.forEach((path) => readPathSet.add(path));
        }
        const readPaths = constrainPathsToRequestedFolder(Array.from(readPathSet), rootDirective, localHistory, fileTree);
        if (readPaths.length === 0) return;

        const openInspector = readPaths.length === 1 && wantsInspectorOpen(rootDirective, result.payload, shouldRedactTurn);
        const readSnapshots: ReadFileSnapshot[] = [];
        try {
          for (const readPath of readPaths.slice(0, 5)) {
            addManualLog("COMMAND", `Executing READ_FILE: ${readPath}`);
            const content = await nexus.readFile(readPath, { openInspector });
            if (content === null) continue;

            const readSnapshot = { path: readPath, content };
            readSnapshots.push(readSnapshot);
            setLastAgentReadFile(readSnapshot);
            const readResponse: ChatMessage = {
              role: 'model',
              content: buildFileReadResponse(rootDirective, readPath, content, openInspector, shouldRedactTurn),
              timestamp: Date.now()
            };
            localHistory = [...localHistory, readResponse];
            setMessages([...localHistory]);
          }

          const lastReadSnapshot = readSnapshots[readSnapshots.length - 1];
          if (!lastReadSnapshot) return;

          if (!openInspector && readSnapshots.length === 1 && wantsEditDirective(rootDirective)) {
            const codewordEdit = tryBuildCodewordReplacementContent(rootDirective, lastReadSnapshot.content);
            if (codewordEdit) {
              const snapshot = await executeWriteFile(lastReadSnapshot.path, codewordEdit.content);
              localHistory = appendModelMessage(
                localHistory,
                `Updated the codeword to "${codewordEdit.codeword}" in ${getFileName(lastReadSnapshot.path)}.\n${buildFileWriteResponse(lastReadSnapshot.path, codewordEdit.content, snapshot.existed)}`,
                "WRITE_FILE",
              );
              return;
            }

            const simpleEdit = tryBuildSimpleReplacementContent(rootDirective, lastReadSnapshot.content);
            if (simpleEdit) {
              const snapshot = await executeWriteFile(lastReadSnapshot.path, simpleEdit.content);
              localHistory = appendModelMessage(
                localHistory,
                `Replaced "${simpleEdit.from}" with "${simpleEdit.to}" in ${getFileName(lastReadSnapshot.path)}.\n${buildFileWriteResponse(lastReadSnapshot.path, simpleEdit.content, snapshot.existed)}`,
                "WRITE_FILE",
              );
              return;
            }
          }

          const shouldContinueForMoreFiles = wantsMultipleFileRead(rootDirective)
            && readPaths.length === 1
            && readDepth < 4;
          if (openInspector || (!wantsEditDirective(rootDirective) && shouldAnswerDirectlyFromRead(rootDirective, shouldRedactTurn) && !shouldContinueForMoreFiles)) {
            return;
          }

          const feedbackContent = readSnapshots
            .map((snapshot) => `FILE: ${snapshot.path}\nCONTENT:\n"""\n${snapshot.content}\n"""`)
            .join("\n\n");

          // RECURSIVE TURN: Content injected immediately into localHistory accumulator
          await processAiTurn(
            `SYSTEM_FEEDBACK: File retrieval completed.
ORIGINAL_DIRECTIVE:
"""
${rootDirective}
"""
${feedbackContent}
Answer the original directive using the retrieved file content. If the original directive asks for another file that has not been retrieved yet, request READ_FILE for that file. Do not open the file inspector unless the original directive explicitly asked to open it.`,
            localHistory,
            true,
            rootDirective,
            lastReadSnapshot,
            readDepth + 1,
            shouldRedactTurn
          );
        } catch (readError: any) {
          addManualLog("ERROR", `READ_FILE FAILED: ${readError.message}`);
          await processAiTurn(
            `SYSTEM_FEEDBACK: READ_FILE_FAILED error=${readError.message}
ORIGINAL_DIRECTIVE:
"""
${rootDirective}
"""
Tell the user the file could not be read and include the failure reason.`,
            localHistory,
            true,
            rootDirective,
            readFileOverride,
            readDepth + 1,
            shouldRedactTurn
          );
        }
      } else if (result.command !== "NONE") {
        addManualLog("COMMAND", `Executing ${result.command}`);
        switch (result.command) {
          case "KILL_PROCESS":
            if (result.payload.pid) await nexus.sendCommand("KILL_PROCESS", { pid: result.payload.pid });
            break;
          case "SET_PATH":
            if (result.payload.path) await nexus.sendCommand("SET_PATH", { path: result.payload.path });
            break;
          case "WRITE_FILE": {
            const payload = result.payload || {};
            const rawPath = getWriteFilePath(payload, lastAgentReadFile?.path || fileContent?.path || "");
            const writePath = rawPath ? resolveCommandPath(rawPath, rootDirective, localHistory) : "";
            if (!writePath) {
              localHistory = appendModelMessage(localHistory, "I need a target file path before I can write the file.");
              break;
            }
            if (!payloadHasWriteContent(payload)) {
              localHistory = appendModelMessage(
                localHistory,
                "I did not receive full replacement content, so I left the file unchanged.",
                "WRITE_FILE",
              );
              break;
            }
            const modelContent = getWriteFileContent(payload);
            const snapshot = await cacheFileBeforeMutation(writePath);
            const codewordEdit = snapshot.content !== null
              ? tryBuildCodewordReplacementContent(rootDirective, snapshot.content)
              : null;
            const content = codewordEdit?.content || modelContent;
            await nexus.writeFile(writePath, content);
            lastMutationPathRef.current = writePath;
            setLastAgentReadFile({ path: writePath, content });
            localHistory = appendModelMessage(
              localHistory,
              codewordEdit
                ? `Updated the codeword to "${codewordEdit.codeword}" in ${getFileName(writePath)}.\n${buildFileWriteResponse(writePath, content, snapshot.existed)}`
                : buildFileWriteResponse(writePath, content, snapshot.existed),
              "WRITE_FILE",
            );
            break;
          }
          case "DELETE_FILE": {
            const payload = result.payload || {};
            const rawPath = getDeleteFilePath(payload, lastAgentReadFile?.path || fileContent?.path || "");
            const deletePath = rawPath ? resolveCommandPath(rawPath, rootDirective, localHistory) : "";
            if (!deletePath) {
              localHistory = appendModelMessage(localHistory, "I need a target file path before I can delete the file.");
              break;
            }
            if (wantsDeleteWithoutConfirmation(rootDirective)) {
              await executeDeleteFile(deletePath);
              localHistory = appendModelMessage(localHistory, buildFileDeleteResponse(deletePath), "DELETE_FILE");
            } else {
              setPendingDelete({
                path: deletePath,
                message: buildDeleteConfirmationMessage(deletePath),
              });
              localHistory = appendModelMessage(localHistory, buildDeleteConfirmationMessage(deletePath), "DELETE_FILE");
            }
            break;
          }
        }
      }

    } catch (error: any) {
      const errorMsg = `Neural Bridge Fault: ${error.message || "Network Timeout"}`;
      setMessages(prev => [...prev, { role: 'model', content: errorMsg, timestamp: Date.now() }]);
      addManualLog("ERROR", errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt || isLoading) return;
    const currentInput = prompt;
    setPrompt("");
    processAiTurn(currentInput, messages, false, currentInput);
  };

  return (
    <>
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="border-destructive/40 bg-background">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />
              Confirm File Delete
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap break-words font-mono text-xs">
              {pendingDelete?.message || "Approve file deletion."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="gap-2">
              <X className="h-3.5 w-3.5" />
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmPendingDelete()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete File
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DashboardCard 
        title="Neural Command" 
        subtitle="AI-Driven Orchestration"
        headerAction={<Sparkles className={cn("w-4 h-4", isLoading ? "text-primary animate-spin" : "text-secondary")} />}
        className="border-primary/20 bg-primary/5"
      >
      <div className="flex flex-col gap-4 h-[350px]">
        <ScrollArea className="flex-1 rounded-lg bg-black/40 border border-white/5 p-4 relative" viewportRef={scrollRef}>
          <div className="absolute top-2 right-2 p-2 opacity-5 pointer-events-none"><Brain className="w-12 h-12" /></div>
          <div className="space-y-4">
            {messages.length === 0 && !isLoading && (
              <div className="text-muted-foreground/40 flex flex-col items-center justify-center h-48 gap-2">
                <Terminal className="w-8 h-8" />
                <p className="uppercase tracking-widest text-[9px]">Neural Link Stable. Awaiting Directive...</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={cn("flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300", msg.role === 'user' ? "items-end" : "items-start")}>
                <div className="flex items-center gap-1.5 px-2">
                  <span className={cn("text-[8px] font-bold uppercase", msg.role === 'model' ? "text-primary" : "text-secondary")}>
                    {msg.role === 'model' ? "Nexus_Op" : "User"}
                  </span>
                  {msg.command && (
                    <div className="flex items-center gap-1 px-1 py-0.5 rounded bg-primary/20 border border-primary/30 text-[7px] text-primary">
                      <Command className="w-2 h-2" />{msg.command}
                    </div>
                  )}
                </div>
                <div className={cn("max-w-[90%] whitespace-pre-wrap break-words p-2 rounded-lg font-mono text-[10px] leading-relaxed", msg.role === 'user' ? "bg-secondary/10 border border-secondary/30 text-secondary shadow-[0_0_14px_rgba(34,197,94,0.08)]" : "bg-primary/5 border border-primary/10 text-foreground/90 italic")}>
                  {msg.content.startsWith('SYSTEM_FEEDBACK') ? 'Processing neural data...' : msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex flex-col items-start gap-1 animate-pulse">
                <span className="text-[8px] font-bold text-primary uppercase px-2">Nexus_Op reasoning...</span>
                <div className="bg-primary/5 border border-primary/10 rounded-lg p-2 w-24">
                  <div className="flex gap-1">
                    <div className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-1 h-1 bg-primary rounded-full animate-bounce" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        <form onSubmit={handleSubmit} className="relative">
          <Input 
            value={prompt ?? ""} 
            onChange={(e) => setPrompt(e.target.value)} 
            placeholder="Input directive..." 
            className="pr-12 bg-black/60 border-primary/20 focus-visible:ring-primary text-xs h-10 font-mono" 
            disabled={isLoading || state === "OFFLINE"} 
          />
          <Button type="submit" size="icon" variant="ghost" className="absolute right-1 top-1 h-8 w-8 text-primary hover:bg-primary/10" disabled={isLoading || !prompt || state === "OFFLINE"}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
        {state === "OFFLINE" && <div className="flex items-center gap-2 text-[9px] text-destructive font-mono animate-pulse"><AlertCircle className="w-3 h-3" /><span>HARDWARE_LINK_OFFLINE</span></div>}
      </div>
      </DashboardCard>
    </>
  );
}
