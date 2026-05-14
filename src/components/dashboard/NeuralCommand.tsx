
"use client";

import { useState, useRef, useEffect } from "react";
import { DashboardCard } from "./DashboardCard";
import { Terminal, Send, Sparkles, AlertCircle, Brain, Command, Trash2, X, Copy, Check } from "lucide-react";
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

type CodewordEdit = {
  content: string;
  codeword: string;
};

type LocalTextEdit = {
  content: string;
  description: string;
};

type SessionMemory = {
  firstUserIntent?: string;
  lastTargetPath?: string;
  lastReadPath?: string;
  lastWritePath?: string;
  lastFilePreview?: string;
  recentFiles: string[];
  recentUserIntents: string[];
  fileEvents: string[];
};

type DirectoryNavigationContext = {
  directive: string;
  fromPath: string;
  toPath: string;
  foldersBefore: FileTreeNode[];
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

function getParentPath(path: string) {
  const normalized = normalizePathSeparators(path).replace(/\/+$/, "");
  const parts = normalized.split("/");
  if (parts.length <= 1) return normalized;
  return parts.slice(0, -1).join("/");
}

function getFileName(path: string) {
  return normalizePathSeparators(path).split("/").filter(Boolean).pop() || path;
}

function compactPreview(content: string, maxLength = 1200) {
  const normalized = redactSensitiveContent(normalizeFileWriteContent(content).trim());
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}\n...[truncated]`
    : normalized;
}

function trimList<T>(items: T[], maxLength: number) {
  return items.slice(Math.max(0, items.length - maxLength));
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

function wantsLocalPathUnredaction(directive: string) {
  return /\b(?:un\s*redact|unredact|no need to redact|dont redact|don't redact|do not redact|without redacting)\b[\s\S]*(?:user\s*name|username|user|name|path)?/i.test(directive)
    || /\b(?:show|send|use)\b[\s\S]*(?:full|real|raw)\s+(?:user\s*)?(?:path|name|username)\b/i.test(directive);
}

function wantsLocalPathRedaction(directive: string) {
  return /\b(?:redact|hide|mask|censor)\b[\s\S]*(?:user\s*name|username|user|local\s+path|path)\b/i.test(directive);
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
  return /\b(revert|undo|roll back|restore previous|previous state|back to where|put .* back|back to how it was|restore .* how it was)\b/i.test(directive);
}

function wantsSessionFirstQuestion(directive: string) {
  const text = directive.toLowerCase();
  return /\bwhat did i ask\b.*\bfirst\b|\bfirst\b.*\basked\b.*\bsession\b/i.test(text)
    || /\bwhat\b[\s\S]*\b(first|earliest|initial)\b[\s\S]*\b(thing|message|prompt|question|request)\b[\s\S]*\bi\b[\s\S]*\b(asked|said|sent|typed)\b[\s\S]*\byou\b/i.test(text)
    || /\b(first|earliest|initial)\b[\s\S]*\bi\b[\s\S]*\b(asked|said|sent|typed)\b[\s\S]*\byou\b/i.test(text)
    || /\bwhat\b[\s\S]*\bi\b[\s\S]*\b(asked|said|sent|typed)\b[\s\S]*\b(first|earliest|initial)\b/i.test(text);
}

function wantsSessionMemoryComplaint(directive: string) {
  return /\b(no|not)\s+mem+or(?:y|ies)\b|\bno\s+mem+emory\b|\bforgot\b.*\b(session|chat|chatlog|conversation)\b/i.test(directive);
}

function wantsToolMisfireComplaint(directive: string) {
  return /\b(mis\s*firing|miss\s*firing|misfire|wrong tool|stiff stuff|too stiff|too rigid|why.*read|should(?:n'|’)?t.*read)\b/i.test(directive);
}

function wantsSessionMessageCount(directive: string) {
  return /\bhow\s+many\b[\s\S]*\b(messages?|prompts?|things)\b[\s\S]*\b(i|user)\b[\s\S]*\b(sent|asked|said|typed)\b/i.test(directive)
    || /\bcount\b[\s\S]*\b(my|user)\b[\s\S]*\b(messages?|prompts?)\b/i.test(directive);
}

function wantsSessionActionSummary(directive: string) {
  return /\bwhat\b[\s\S]*\b(things|stuff|actions|tasks)\b[\s\S]*\b(i|we)\b[\s\S]*\b(had|asked|did|done)\b[\s\S]*\b(session|today|chat)\b/i.test(directive)
    || /\bsummar(?:y|ize)\b[\s\S]*\b(session|chat|what we did|things i asked)\b/i.test(directive);
}

function wantsSessionEditRequestRecall(directive: string) {
  return /\bwhat\b[\s\S]*\b(my|the)\b[\s\S]*\b(ask|request|prompt)\b[\s\S]*\b(edit|file edit|change)\b/i.test(directive)
    || /\bwhat\b[\s\S]*\b(i|you)\b[\s\S]*\b(asked|said)\b[\s\S]*\b(edit|change)\b[\s\S]*\bfile\b/i.test(directive);
}

function wantsCodewordHistoryQuestion(directive: string) {
  return /\bhow\s+many\b[\s\S]*\b(words?|code\s*words?|codewords?)\b[\s\S]*\b(session|gone through|used|changed|set)\b/i.test(directive)
    || /\b(words?|code\s*words?|codewords?)\b[\s\S]*\bgone through\b[\s\S]*\bsession\b/i.test(directive);
}

function wantsCorrectionOnly(directive: string) {
  const text = directive.toLowerCase();
  const soundsLikeCorrection = /\b(i only asked|only asked|did(?:n'|’)?t ask|didnt ask|that was an error|that was wrong|not what i asked)\b/.test(text);
  const hasNewAction = /\b(read|open|change|replace|write|delete|create|make|show me|what does|what is|what's)\b/.test(text);
  return soundsLikeCorrection && !hasNewAction;
}

function wantsStatusNudge(directive: string) {
  return /^\s*(\?+|h+m+|hmm+|uh+|ok+\??)\s*$/i.test(directive);
}

function wantsCasualConversation(directive: string) {
  const text = directive.toLowerCase();
  const hasFileIntent = /\b(file|folder|txt|text\.txt|test\.txt|info\.txt|notes?|read|open|write|edit|change|delete|content|contents|code\s*word|codeword|system|process|cpu|ram|temp|router|uplink)\b/.test(text);
  if (hasFileIntent) return false;
  return /\b(tell me a joke|joke|make me laugh|boop|hi|hello|hey|silly|chat|good job|good work|good good|nice)\b/i.test(directive)
    || /\b(tell me|give me)\b[\s\S]*\b(new|another)\b[\s\S]*\b(one|joke)\b/i.test(directive);
}

function buildCasualResponse(directive: string) {
  const text = directive.toLowerCase();
  if (/\b(new|another)\b[\s\S]*\b(one|joke)\b/.test(text)) {
    return "Why did the cache bring a notebook? It wanted to remember what actually happened.";
  }
  if (/\bjoke|make me laugh\b/.test(text)) {
    return "Why did the function stop arguing? It finally returned.";
  }
  if (/\bgood job|good work|good good|nice\b/.test(text)) {
    return "Got it.";
  }
  if (/\bsilly\b/.test(text)) {
    return "A little. I can loosen up without touching the file tools.";
  }
  if (/\bboop\b/.test(text)) {
    return "Boop received. Neural tools staying holstered until you ask for them.";
  }
  return "I’m here. What do you want to work on?";
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

function redactHighConfidenceSecrets(value: string) {
  return value
    .replace(/\bnvapi-[A-Za-z0-9_-]+/g, "[REDACTED_NVIDIA_API_KEY]")
    .replace(/(api\s*key\s*\d*\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(token\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(secret\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(password\s*:\s*)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(/(codex\s+resume\s+)[A-Za-z0-9-]+/gi, "$1[REDACTED_SESSION]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[REDACTED_ID]");
}

function redactSensitiveContent(value: string) {
  return redactHighConfidenceSecrets(value)
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

function humanizeModelMessage(message: string, shouldRedact = false, redactor = redactSensitiveContent) {
  const parsed = parseMaybeJsonMessage(message);
  let display: string;
  if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
    display = humanizeObjectMessage(parsed as Record<string, unknown>);
  } else if (Array.isArray(parsed)) {
    display = parsed.map((entry) => formatObjectValue(entry)).join("\n");
  } else {
    display = normalizePathSeparators(message);
  }

  return shouldRedact ? redactor(display) : redactHighConfidenceSecrets(display);
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
  return /\b(both|all|each|files|and also|test.*info|info.*test)\b/.test(text)
    || (/\band\b/.test(text) && /\b(file|files|txt|text)\b/.test(text));
}

function hasFileReference(directive: string) {
  return getExplicitFileNames(directive).length > 0
    || /\b(file|files|folder|folders|txt|text file|current file|that file|the file|it|inside it|content|contents|code\s*word|codeword|notes?|info)\b/i.test(directive);
}

function isFileReadDirective(directive: string) {
  const asksForRead = /\b(read|open|show|view|what.*in|what.*says?|tell me what|content|contents)\b/i.test(directive);
  return asksForRead && hasFileReference(directive);
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

function getExplicitFileNames(directive: string) {
  const names = new Set<string>();
  for (const match of directive.matchAll(/\b[\w.-]+\.[A-Za-z0-9]{1,8}\b/gi)) {
    names.add(match[0].toLowerCase());
  }
  if (/\btest\s+(?:text\s+)?file\b|\btest file\b/i.test(directive)) names.add("test.txt");
  if (/\btext\.txt\b/i.test(directive)) names.add("test.txt");
  if (/\binfo\s+(?:text\s+)?file\b|\binfo file\b/i.test(directive)) names.add("info.txt");
  return Array.from(names);
}

function getRequestedFilePaths(directive: string, history: ChatMessage[], fileTree: unknown) {
  const explicitNames = getExplicitFileNames(directive);
  if (explicitNames.length === 0) return [];

  const nodes = flattenFileTree(fileTree);
  const fileNodes = nodes.filter((node) => isFileNode(node) && typeof node.path === "string");
  const folderNames = getRelevantFolderNames(directive, history);
  const matches = fileNodes.filter((file) => {
    const fileName = String(file.name || getFileName(file.path!)).toLowerCase();
    const path = normalizePathSeparators(file.path!).toLowerCase();
    const nameMatches = explicitNames.includes(fileName) || explicitNames.some((name) => path.endsWith(`/${name}`));
    if (!nameMatches) return false;
    if (folderNames.length === 0) return true;
    return folderNames.some((folderName) => pathIsUnderFolder(path, folderName));
  });

  return matches.map((file) => normalizePathSeparators(file.path!));
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

function normalizeFolderLookupValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactFolderLookupValue(value: string) {
  return normalizeFolderLookupValue(value).replace(/\s+/g, "");
}

function folderNameMatchesQuery(folderName: string, query: string) {
  const normalizedFolder = normalizeFolderLookupValue(folderName);
  const normalizedQuery = normalizeFolderLookupValue(query.replace(/\bfolders?\b|\bdirectory\b|\bthe\b/gi, ""));
  if (!normalizedFolder || !normalizedQuery) return false;

  const compactFolder = compactFolderLookupValue(normalizedFolder);
  const compactQuery = compactFolderLookupValue(normalizedQuery);
  return normalizedFolder === normalizedQuery
    || normalizedFolder.includes(normalizedQuery)
    || normalizedQuery.includes(normalizedFolder)
    || compactFolder.includes(compactQuery)
    || compactQuery.includes(compactFolder);
}

function getTopLevelTreeNodes(fileTree: unknown) {
  return Array.isArray(fileTree) ? fileTree as FileTreeNode[] : [];
}

function getCurrentTreeRootPath(fileTree: unknown, workingDirectory = "") {
  const normalizedWorkingDirectory = normalizePathSeparators(workingDirectory || "").replace(/\/+$/, "");
  if (normalizedWorkingDirectory) return normalizedWorkingDirectory;

  const firstNodePath = getTopLevelTreeNodes(fileTree)
    .map((node) => typeof node.path === "string" ? normalizePathSeparators(node.path).replace(/\/+$/, "") : "")
    .find(Boolean);
  return firstNodePath ? getParentPath(firstNodePath) : "";
}

function getAncestorDirectoryPaths(pathValue: string) {
  const normalized = normalizePathSeparators(pathValue).replace(/\/+$/, "");
  if (!normalized) return [];

  const parts = normalized.split("/");
  const ancestors: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    if (index === 0 && /^[A-Za-z]:$/.test(part)) continue;
    ancestors.push(parts.slice(0, index + 1).join("/"));
  }
  return ancestors;
}

function getDirectoryQueryName(directive: string) {
  if (extractExplicitDirectoryPath(directive)) return "";
  const patterns = [
    /\bwhat\s+folders?\s+(?:are\s+)?(?:found\s+)?(?:in|inside|under)\s+(?:the\s+)?(.+?)(?:\s+folder)?[?.!]*$/i,
    /\bfolders?\s+(?:are\s+)?(?:found\s+)?(?:in|inside|under)\s+(?:the\s+)?(.+?)(?:\s+folder)?[?.!]*$/i,
    /\bwhat\s+about\s+(?:the\s+)?folders?\s+(?:in|inside|under)\s+(?:the\s+)?(.+?)(?:\s+folder)?[?.!]*$/i,
    /\bwhat\s+(?:about|avout)\s+(?:the\s+)?(.+?)(?:\s+folder)?[?.!]*$/i,
  ];

  for (const pattern of patterns) {
    const match = directive.match(pattern);
    if (!match?.[1]) continue;
    const value = match[1]
      .replace(/\bnexus\s+root\b/ig, "")
      .replace(/\bcurrent\s+(?:recursive\s+mirror|mirror|root)\b/ig, "")
      .replace(/\bfolders?\b/ig, "")
      .replace(/\bfolder\b/ig, "")
      .replace(/\bthe\b/ig, "")
      .replace(/\bthink\s+about\s+it\b/ig, "")
      .trim();
    if (value) return value;
  }

  return "";
}

function findDirectoryPathByQuery(query: string, fileTree: unknown, workingDirectory = "") {
  const currentRoot = getCurrentTreeRootPath(fileTree, workingDirectory);
  const nodes = flattenFileTree(fileTree);
  const folderNodes = nodes.filter((node) => isFolderNode(node) && typeof node.path === "string");

  if (currentRoot && folderNameMatchesQuery(getFileName(currentRoot), query)) {
    return currentRoot;
  }

  const ancestorMatch = getAncestorDirectoryPaths(currentRoot)
    .reverse()
    .find((ancestorPath) => folderNameMatchesQuery(getFileName(ancestorPath), query));
  if (ancestorMatch) return ancestorMatch;

  const treeMatch = folderNodes.find((node) => {
    const folderName = String(node.name || getFileName(node.path!));
    return folderNameMatchesQuery(folderName, query);
  });
  return treeMatch?.path ? normalizePathSeparators(treeMatch.path) : "";
}

function getFolderNode(nodes: FileTreeNode[], folderName: string) {
  return nodes.find((node) => isFolderNode(node) && folderNameMatchesQuery(String(node.name || ""), folderName));
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
  const asksWhatsInFolder = /\bwhat(?:'s| is|s)?\s+in\b/.test(text) || /\bwhats\s+in\b/.test(text);
  const correctionToListFiles = /\bshould have said\b.*\bfiles\b|\bwhat files are (?:there|ther)\b/.test(text);

  return folderNames.length > 0 && (asksFolderQuestion || asksWhatsInFolder || correctionToListFiles);
}

function buildFolderInventoryResponse(
  directive: string,
  history: ChatMessage[],
  fileTree: unknown,
  redactor = redactSensitiveContent,
) {
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
  const pathLine = wantsPath && folder.path ? `\nPath: ${redactor(normalizePathSeparators(folder.path))}` : "";
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

function wantsWorkspaceInventory(directive: string) {
  const text = directive.toLowerCase();
  if (wantsEditDirective(directive) || wantsDeleteDirective(directive) || wantsExplicitOpen(directive)) return false;
  if (/\b(read|content|contents|code\s*word|codeword)\b/i.test(directive)) return false;
  return /\bwhat\b[\s\S]*\b(files?|folders?)\b[\s\S]*\b(can you|you can|do you)\b[\s\S]*\b(se+|see|view)\b/i.test(text)
    || /\bwhat\b[\s\S]*\b(can you|do you)\b[\s\S]*\b(se+|see|view)\b[\s\S]*\b(files?|folders?)\b/i.test(text)
    || /\blist\b[\s\S]*\b(files?|folders?)\b[\s\S]*\b(workspace|root|here)\b/i.test(text)
    || /\bwhat\b[\s\S]*\bfolder\s+names?\b[\s\S]*\b(recursive|resursive|mirror|memory|memeory)\b/i.test(text)
    || /\bfolders?\b[\s\S]*\b(recursive|resursive)\b[\s\S]*\b(memory|memeory|mirror)\b/i.test(text);
}

function buildWorkspaceInventoryResponse(fileTree: unknown) {
  const nodes = Array.isArray(fileTree) ? fileTree as FileTreeNode[] : [];
  if (nodes.length === 0) return "I do not have a visible workspace tree yet.";

  const folders = nodes
    .filter((node) => isFolderNode(node))
    .map((node) => node.name || (node.path ? getFileName(node.path) : "unnamed folder"))
    .filter(Boolean);
  const files = nodes
    .filter((node) => isFileNode(node))
    .map((node) => node.name || (node.path ? getFileName(node.path) : "unnamed file"))
    .filter(Boolean);

  return [
    "I can see these top-level folders and files:",
    "",
    "Folders:",
    folders.length > 0 ? folders.map((name) => `- ${name}`).join("\n") : "- (none)",
    "",
    "Files:",
    files.length > 0 ? files.map((name) => `- ${name}`).join("\n") : "- (none)",
  ].join("\n");
}

function wantsFolderOnlyListing(directive: string, history: ChatMessage[] = []) {
  const text = directive.toLowerCase();
  if (wantsCurrentFolderQuestion(directive) || wantsDirectoryNavigation(directive)) return false;
  if (wantsEditDirective(directive) || wantsDeleteDirective(directive) || wantsExplicitOpen(directive)) return false;
  if (/\b(read|content|contents|code\s*word|codeword)\b/i.test(directive)) return false;
  const previousFolderQuestion = history
    .filter((message) => message.role === "user")
    .slice(-4, -1)
    .some((message) => /\bfolders?\b|\bdirector(?:y|ies)\b|\brecursive\s+(?:mirror|memory|memeory)\b/i.test(message.content));
  return /\bwhat\b[\s\S]*\bfolders?\b[\s\S]*\b(here|there|in|inside|parent|path|root)\b/i.test(text)
    || /\bfolder\s+names?\b/i.test(text)
    || /\bfolders?\b[\s\S]*\bparent\b[\s\S]*\bnexus\s+root\b/i.test(text)
    || /\b[A-Za-z]:[\\/]/.test(directive)
    || (previousFolderQuestion && /\bwhat\s+(?:about|avout)\b/i.test(text));
}

function wantsCurrentFolderQuestion(directive: string) {
  return /\bwhat\s+folder\b[\s\S]*\b(are\s+we|we\s+are|am\s+i|on|in|at)\b[\s\S]*\b(right now|currently|now|rn)\b/i.test(directive)
    || /\bwhat\s+folder\s+are\s+we\s+(?:in|on|at)\b/i.test(directive)
    || /\bwhere\b[\s\S]*\b(recursive\s+mirror|mirror|nexus\s+root|folder)\b[\s\S]*\b(now|currently|at)\b/i.test(directive);
}

function buildCurrentFolderResponse(fileTree: unknown, workingDirectory = "", redactor = redactSensitiveContent) {
  const currentRoot = getCurrentTreeRootPath(fileTree, workingDirectory);
  if (!currentRoot) return "I do not have a current Recursive Mirror folder path yet.";
  return `The current Recursive Mirror folder is ${getFileName(currentRoot)}.\nPath: ${redactor(currentRoot)}`;
}

function extractExplicitDirectoryPath(directive: string) {
  const match = directive.match(/[A-Za-z]:[\\/][^\r\n"'`]+/);
  if (!match) return "";
  return normalizePathSeparators(match[0])
    .replace(/[?.!,;:)\]]+$/g, "")
    .trim();
}

function extractTreePayload(response: any) {
  return Array.isArray(response)
    ? { tree: response as FileTreeNode[], path: "" }
    : {
        tree: response?.payload?.tree || response?.tree || response?.payload || [],
        path: response?.payload?.path || response?.path || "",
      };
}

function buildFolderOnlyResponse(tree: unknown, label = "current Recursive Mirror root") {
  const nodes = Array.isArray(tree) ? tree as FileTreeNode[] : [];
  const folders = nodes
    .filter((node) => isFolderNode(node))
    .map((node) => node.name || (node.path ? getFileName(node.path) : "unnamed folder"))
    .filter(Boolean);

  if (folders.length === 0) {
    return `I do not see any direct folders in ${label}.`;
  }

  return `Folders in ${label}:\n${folders.map((folderName) => `- ${folderName}`).join("\n")}`;
}

function buildDirectorySetPathResponse(response: any, fallbackPath: string, redactor = redactSensitiveContent) {
  const { tree, path } = extractTreePayload(response);
  const targetPath = normalizePathSeparators(path || fallbackPath).replace(/\/+$/, "");
  const folderName = getFileName(targetPath) || targetPath;
  const folders = getDirectFolderNodes(tree)
    .map((node) => node.name || (node.path ? getFileName(node.path) : "unnamed folder"))
    .filter(Boolean);
  const folderLines = folders.length > 0
    ? `\nFolders:\n${folders.map((name) => `- ${name}`).join("\n")}`
    : "\nFolders:\n- (none)";

  return `Now in ${folderName}.\nPath: ${redactor(targetPath)}${folderLines}`;
}

function getDirectFolderNodes(fileTree: unknown) {
  return getTopLevelTreeNodes(fileTree).filter((node) => isFolderNode(node));
}

function getOrdinalWordIndex(value: string) {
  const ordinals: Record<string, number> = {
    first: 0,
    second: 1,
    secound: 1,
    third: 2,
    fourth: 3,
    fifth: 4,
    sixth: 5,
    seventh: 6,
    eighth: 7,
    ninth: 8,
    tenth: 9,
  };
  return Object.prototype.hasOwnProperty.call(ordinals, value.toLowerCase())
    ? ordinals[value.toLowerCase()]
    : -1;
}

function getOrdinalFolderIndex(directive: string, folderCount = 0) {
  const normalized = directive.toLowerCase();
  const numericToLast = normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:to|from)\s+last\s+folders?\b/);
  if (numericToLast && folderCount > 0) {
    return Math.max(0, folderCount - Number(numericToLast[1]));
  }

  const wordToLast = normalized.match(/\b(first|second|secound|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:to|from)\s+last\s+folders?\b/);
  if (wordToLast && folderCount > 0) {
    const offset = getOrdinalWordIndex(wordToLast[1]) + 1;
    return Math.max(0, folderCount - offset);
  }

  if (/\blast\s+folders?\b/.test(normalized) && folderCount > 0) return folderCount - 1;

  const numeric = normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+folders?\b/);
  if (numeric) return Number(numeric[1]) - 1;

  for (const word of ["first", "second", "secound", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"]) {
    if (new RegExp(`\\b${word}\\s+folders?\\b`).test(normalized)) return getOrdinalWordIndex(word);
  }

  return -1;
}

function getNavigationFolderQuery(directive: string) {
  const patterns = [
    /\b(?:take|send)\s+(?:us|me)?\s*(?:to|into|inside)\s+(?:the\s+)?(.+?)(?:\s+folder)?[?.!]*$/i,
    /\b(?:go|move|navigate|jump|enter|open)\s+(?:into|in|to|inside)\s+(?:the\s+)?(.+?)(?:\s+folder)?[?.!]*$/i,
    /\b(?:go|move|navigate|jump|enter|open)\s+(?:the\s+)?(.+?)(?:\s+folder)?[?.!]*$/i,
    /\bback\s+(?:inside|into|in)\s+(?:the\s+)?(.+?)(?:\s+folder)?(?:\s+and\b|[?.!]*$)/i,
    /\b(?:set|change)\s+(?:the\s+)?(?:recursive\s+mirror\s+)?(?:path|folder|directory)\s+(?:to|as)\s+(?:the\s+)?(.+?)(?:\s+folder)?[?.!]*$/i,
  ];

  for (const pattern of patterns) {
    const match = directive.match(pattern);
    const value = match?.[1]
      ?.replace(/\b(?:first|second|secound|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2}(?:st|nd|rd|th)?)\s+folders?\b/ig, "")
      .replace(/\bfolders?\b/ig, "")
      .replace(/\bthe\b/ig, "")
      .trim();
    if (value) return value;
  }

  return "";
}

function cleanBareFolderDirective(directive: string) {
  return directive
    .replace(/[?.!,;:]+$/g, "")
    .replace(/\b(?:ok|okay|now|please|pls|then)\b/gi, " ")
    .replace(/\b(?:folder|directory)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wantsDirectoryNavigation(directive: string) {
  const text = directive.toLowerCase();
  if (wantsEditDirective(directive) || wantsDeleteDirective(directive)) return false;
  if (/\b[\w.-]+\.[A-Za-z0-9]{1,8}\b/.test(directive)) return false;
  return /\b(?:go|move|navigate|jump|enter|open)\s+(?:into|in|to|inside)\b[\s\S]*\bfolders?\b/i.test(directive)
    || /\b(?:go|move|navigate|jump|enter|open|take|send)\b[\s\S]*\b(?:unidex|documents|workshop|folder)\b/i.test(directive)
    || /\b(?:go|move|navigate|jump)\b[\s\S]*\bparent\b[\s\S]*\b(?:enter|open|go|take)\b/i.test(directive)
    || /\bback\s+(?:inside|into|in)\b/i.test(directive)
    || /\bi\s+meant\b/i.test(directive)
    || /\bnow\s+(?:in|inside|into)\b[\s\S]*(?:folders?|last)\b/i.test(directive)
    || /\b(?:\d{1,2}(?:st|nd|rd|th)?|first|second|secound|third|fourth|fifth)\s+(?:to|from)\s+last\s+folders?\b/i.test(directive)
    || /\blast\s+folders?\b/i.test(directive)
    || /\b(?:enter|open|take|send)\b\s+[\w -]{2,80}$/i.test(directive.trim())
    || /\b(?:go|move|navigate|jump|take)\s+(?:us|use|me)?\s*back\b/i.test(directive)
    || /\b(?:go|move|navigate|jump)\s+up\b/i.test(text)
    || /\b(?:parent|previous)\s+folders?\b/i.test(directive)
    || /\b(?:set|change)\s+(?:the\s+)?(?:recursive\s+mirror\s+)?(?:path|folder|directory)\s+(?:to|as)\b/i.test(directive);
}

function resolveDirectoryPathCandidate(pathValue: string, fileTree: unknown, workingDirectory = "") {
  const normalized = normalizePathSeparators(pathValue).replace(/\/+$/, "");
  if (!normalized) return "";
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) return normalized;

  const currentRoot = getCurrentTreeRootPath(fileTree, workingDirectory);
  const directMatch = getDirectFolderNodes(fileTree).find((node) => {
    const nodeName = String(node.name || (node.path ? getFileName(node.path) : ""));
    return folderNameMatchesQuery(nodeName, normalized);
  });
  if (directMatch?.path) return normalizePathSeparators(directMatch.path);

  const treeMatch = flattenFileTree(fileTree).find((node) => {
    if (!isFolderNode(node) || typeof node.path !== "string") return false;
    const nodeName = String(node.name || getFileName(node.path));
    return folderNameMatchesQuery(nodeName, normalized);
  });
  if (treeMatch?.path) return normalizePathSeparators(treeMatch.path);

  return currentRoot ? `${currentRoot}/${normalized}` : normalized;
}

function resolveDirectFolderPathCandidate(pathValue: string, fileTree: unknown) {
  const normalized = normalizePathSeparators(pathValue).replace(/\/+$/, "");
  if (!normalized) return "";

  const directMatch = getDirectFolderNodes(fileTree).find((node) => {
    const nodeName = String(node.name || (node.path ? getFileName(node.path) : ""));
    return folderNameMatchesQuery(nodeName, normalized);
  });
  return directMatch?.path ? normalizePathSeparators(directMatch.path) : "";
}

function getNavigationCorrectionTarget(directive: string, context: DirectoryNavigationContext | null) {
  if (!context || !/\bi\s+meant\b|\bnot\b/i.test(directive)) return "";
  const text = directive.toLowerCase();
  const previousText = context.directive.toLowerCase();
  const folderCount = context.foldersBefore.length;

  let index = getOrdinalFolderIndex(directive, folderCount);
  if (index < 0 && /\bsecond\b|\bsecound\b|\b2nd\b/i.test(directive) && /\blast\b|send\s+to\s+last/i.test(previousText)) {
    index = Math.max(0, folderCount - 2);
  }
  if (index < 0 && /\bfirst\b|\b1st\b/i.test(directive)) index = 0;
  if (index < 0) return "";

  const folder = context.foldersBefore[index];
  return folder?.path ? normalizePathSeparators(folder.path) : "";
}

function getParentThenChildNavigationTarget(directive: string, fileTree: unknown, workingDirectory = "") {
  if (!/\bparent\b[\s\S]*\b(?:enter|open|go|take)\b/i.test(directive)) return "";
  const currentRoot = getCurrentTreeRootPath(fileTree, workingDirectory);
  if (!currentRoot) return "";

  const childMatches = Array.from(
    directive.matchAll(/\b(?:and\s+)?(?:enter|open)\s+(?:into|in|to|inside)?\s*(?:the\s+)?(.+?)(?:\s+folder)?(?=$|[?.!])/gi)
  );
  const query = childMatches.at(-1)?.[1]
    ?.replace(/\bfolders?\b/ig, "")
    .replace(/\bthe\b/ig, "")
    .trim() || "";
  if (!query) return getParentPath(currentRoot);

  const parentPath = getParentPath(currentRoot);
  return { parentPath, query };
}

function getDirectoryNavigationTarget(
  directive: string,
  fileTree: unknown,
  workingDirectory = "",
  returnInsideTarget = "",
  lastNavigation: DirectoryNavigationContext | null = null,
) {
  const correctionTarget = getNavigationCorrectionTarget(directive, lastNavigation);
  if (correctionTarget) return correctionTarget;

  const currentRoot = getCurrentTreeRootPath(fileTree, workingDirectory);
  const text = directive.toLowerCase();
  const wantsReturnInside = /\bback\s+(?:inside|into|in)\s+(?:it|that|there|folder)\b/i.test(directive)
    || /\bback\s+(?:inside|into|in)\b/i.test(directive);
  if (wantsReturnInside && returnInsideTarget) {
    const normalizedReturnTarget = normalizePathSeparators(returnInsideTarget).replace(/\/+$/, "");
    if (!currentRoot || getParentPath(normalizedReturnTarget).toLowerCase() === currentRoot.toLowerCase()) {
      return normalizedReturnTarget;
    }
  }

  const wantsParent = /\b(?:go|move|navigate|jump|take)\s+(?:us|use|me)?\s*back\b/i.test(directive)
    || /\b(?:go|move|navigate|jump)\s+up\b/i.test(text)
    || /\b(?:parent|previous)\s+folders?\b/i.test(directive);
  if (wantsParent) return currentRoot ? getParentPath(currentRoot) : "";

  const directFolders = getDirectFolderNodes(fileTree);
  const ordinalIndex = getOrdinalFolderIndex(directive, directFolders.length);
  if (ordinalIndex >= 0) {
    const folder = directFolders[ordinalIndex];
    return folder?.path ? normalizePathSeparators(folder.path) : "";
  }

  const query = getNavigationFolderQuery(directive);
  if (query) return resolveDirectoryPathCandidate(query, fileTree, workingDirectory);

  const bareQuery = cleanBareFolderDirective(directive);
  if (bareQuery && bareQuery.split(/\s+/).length <= 5) {
    return resolveDirectFolderPathCandidate(bareQuery, fileTree);
  }

  return "";
}

function getDirectoryContextLines(fileTree: unknown, currentRoot: string, workingDirectory = "") {
  const topLevelFolders = getTopLevelTreeNodes(fileTree)
    .filter((node) => isFolderNode(node))
    .map((node) => {
      const name = node.name || (node.path ? getFileName(node.path) : "unnamed folder");
      const path = node.path ? ` => ${normalizePathSeparators(node.path)}` : "";
      return `- ${name}${path}`;
    });
  const visibleFolders = flattenFileTree(fileTree)
    .filter((node) => isFolderNode(node) && typeof node.path === "string")
    .slice(0, 80)
    .map((node) => `- ${node.name || getFileName(node.path!)} => ${normalizePathSeparators(node.path!)}`);
  const ancestors = getAncestorDirectoryPaths(currentRoot || workingDirectory)
    .map((ancestor) => `- ${getFileName(ancestor)} => ${ancestor}`);

  return [
    `CURRENT_RECURSIVE_MIRROR_ROOT: ${currentRoot || "unknown"}`,
    `CURRENT_WORKING_DIRECTORY: ${workingDirectory || "unknown"}`,
    "CURRENT_PATH_ANCESTORS:",
    ancestors.length > 0 ? ancestors.join("\n") : "- none",
    "DIRECT_VISIBLE_FOLDERS:",
    topLevelFolders.length > 0 ? topLevelFolders.join("\n") : "- none",
    "VISIBLE_FOLDER_INDEX:",
    visibleFolders.length > 0 ? visibleFolders.join("\n") : "- none",
  ].join("\n");
}

function buildDirectoryResolverPrompt({
  directive,
  fileTree,
  currentRoot,
  workingDirectory,
}: {
  directive: string;
  fileTree: unknown;
  currentRoot: string;
  workingDirectory: string;
}) {
  return `SYSTEM_FEEDBACK: DIRECTORY_LIST_RESOLVE
Resolve the user's natural-language folder question into one real directory path.

RULES:
- Return pure JSON only.
- Use command SET_PATH with payload.path set to the exact directory to list.
- Never use READ_FILE, WRITE_FILE, DELETE_FILE, or RENAME_FILE for this resolver.
- The local router will list direct child folders after you resolve the target.
- If the user says "here", "current folder", "recursive mirror root", or gives no target, use CURRENT_RECURSIVE_MIRROR_ROOT.
- If the user asks for a parent or ancestor folder by name, use CURRENT_PATH_ANCESTORS. For example, if CURRENT_RECURSIVE_MIRROR_ROOT is C:/Users/USERNAME/Documents/Unidex File, then "Documents" means C:/Users/USERNAME/Documents and "Unidex File" means C:/Users/USERNAME/Documents/Unidex File.
- If the user gives an absolute path, use that path.
- If the target cannot be resolved, use CURRENT_RECURSIVE_MIRROR_ROOT and explain uncertainty in message.

${getDirectoryContextLines(fileTree, currentRoot, workingDirectory)}

USER_DIRECTIVE:
"""
${directive}
"""

Response format:
{"thought":"resolved directory target","command":"SET_PATH","payload":{"path":"C:/..."}, "message":"Listing folders in ..."}`
}

function getPayloadString(payload: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return normalizePathSeparators(value.trim());
  }
  return "";
}

function getDirectoryPathFromCommandResult(result: { command: string; payload?: Record<string, any> }) {
  const payload = result.payload || {};
  return getPayloadString(payload, ["path", "directory", "folder", "targetPath", "target", "cwd", "workingDirectory"]);
}

function getFallbackDirectoryTarget(input: string, fileTree: unknown, workingDirectory = "") {
  const explicitPath = extractExplicitDirectoryPath(input);
  const asksParentOfNexusRoot = /\bparent\b[\s\S]*\bnexus\s+root\b/i.test(input);
  const currentRoot = getCurrentTreeRootPath(fileTree, workingDirectory);
  const requestedDirectoryName = getDirectoryQueryName(input);
  const resolvedDirectoryPath = requestedDirectoryName
    ? findDirectoryPathByQuery(requestedDirectoryName, fileTree, workingDirectory)
    : "";

  return explicitPath
    || (asksParentOfNexusRoot && currentRoot ? getParentPath(currentRoot) : "")
    || resolvedDirectoryPath
    || currentRoot;
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

function constrainPathsToExplicitFiles(paths: string[], directive: string, history: ChatMessage[], fileTree: unknown) {
  const explicitNames = getExplicitFileNames(directive);
  if (explicitNames.length === 0) return paths;

  const matchingPayloadPaths = paths.filter((pathValue) => {
    const fileName = getFileName(pathValue).toLowerCase();
    const lowerPath = normalizePathSeparators(pathValue).toLowerCase();
    return explicitNames.includes(fileName) || explicitNames.some((name) => lowerPath.endsWith(`/${name}`));
  });
  if (matchingPayloadPaths.length > 0) return matchingPayloadPaths;

  const requestedPaths = getRequestedFilePaths(directive, history, fileTree);
  return requestedPaths.length > 0 ? requestedPaths : paths;
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
  const asksForFolderFiles = wantsMultipleFileRead(directive)
    || /\b(all|both|each)\b.*\bfiles\b/i.test(directive)
    || /\bfiles\b.*\b(folder|there|ther|inside)\b/i.test(directive);
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
    if (typeof value === "string") return normalizeFileWriteContent(value);
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

function getRenameFromPath(payload: Record<string, any>, fallbackPath = "") {
  return firstPayloadString(payload.fromPath, payload.from_path, payload.sourcePath, payload.source, payload.oldPath, payload.old_path, fallbackPath);
}

function getRenameToPath(payload: Record<string, any>) {
  return firstPayloadString(payload.toPath, payload.to_path, payload.targetPath, payload.destination, payload.newPath, payload.new_path);
}

function wantsRenameFileDirective(directive: string) {
  const text = directive.toLowerCase();
  if (/\b(copy|duplicate|clone)\b/.test(text)) return false;
  return /\brename\b[\s\S]*\b(file|txt|text|name|to)\b/.test(text)
    || /\bchange\b[\s\S]*\bfile\s+name\b[\s\S]*\bto\b/.test(text)
    || /\bchange\b[\s\S]*\bname\b[\s\S]*\bof\b[\s\S]*\b(file|txt|text)\b[\s\S]*\bto\b/.test(text);
}

function getRenameDestinationName(directive: string) {
  const patterns = [
    /\b(?:rename|change)\b[\s\S]*?\b(?:file\s+)?name\b[\s\S]*?\b(?:to|as)\s+["'`]?([^\s"'`]+)["'`]?/i,
    /\brename\b[\s\S]*?\bto\s+["'`]?([^\s"'`]+)["'`]?/i,
  ];

  for (const pattern of patterns) {
    const value = cleanReplacementTerm(directive.match(pattern)?.[1] || "");
    if (value) return value.replace(/[.,!?]+$/, "");
  }
  return "";
}

function buildSiblingRenamePath(sourcePath: string, destinationName: string) {
  const normalizedSource = normalizePathSeparators(sourcePath).replace(/\/+$/, "");
  const normalizedDestination = normalizePathSeparators(destinationName).replace(/\/+$/, "");
  if (!normalizedSource || !normalizedDestination || normalizedDestination === "." || normalizedDestination === "..") return "";
  if (/^[a-zA-Z]:\//.test(normalizedDestination) || normalizedDestination.includes("/")) return normalizedDestination;

  const segments = normalizedSource.split("/");
  segments[segments.length - 1] = normalizedDestination;
  return segments.join("/");
}

function getFirstUserQuestion(history: ChatMessage[]) {
  return history.find((message) => message.role === "user")?.content || "";
}

function buildSessionFirstQuestionResponse(firstQuestion: string) {
  if (!firstQuestion) return "I do not have an earlier user request in this page session.";
  return `The first thing you asked in this page session was:\n\n"${redactSensitiveContent(firstQuestion)}"`;
}

function buildFileWriteResponse(path: string, content: string, hadSnapshot: boolean, redactor = redactSensitiveContent) {
  const rollback = hadSnapshot
    ? "Previous content is cached for this page session, so you can ask me to revert it before reload."
    : "This file did not have a readable previous state cached.";
  return `Saved ${getFileName(path)}.\nPath: ${redactor(normalizePathSeparators(path))}\nBytes: ${content.length}\n${rollback}`;
}

function buildFileDeleteResponse(path: string, redactor = redactSensitiveContent) {
  return `Deleted ${getFileName(path)}.\nPath: ${redactor(normalizePathSeparators(path))}\nPrevious content is cached for this page session when it was readable.`;
}

function buildFileRenameResponse(fromPath: string, toPath: string, redactor = redactSensitiveContent) {
  return `Renamed ${getFileName(fromPath)} to ${getFileName(toPath)}.\nFrom: ${redactor(normalizePathSeparators(fromPath))}\nTo: ${redactor(normalizePathSeparators(toPath))}`;
}

function buildDeleteConfirmationMessage(path: string, redactor = redactSensitiveContent) {
  return `Deletion requires confirmation.\n\nTarget: ${redactor(normalizePathSeparators(path))}\n\nApprove this dialog to delete it, or cancel to leave the file untouched.`;
}

function normalizeFileWriteContent(content: string) {
  return content.replace(/\\r\\n/g, "\r\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
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
    /\b(?:make|set|edit|change|update)\s+(?:the\s+)?code\s*word\s+(?:to\s+be\s+|to\s+|as\s+|=\s*)?(.+?)(?=$|[.?!,]|\s+(?:then|after that|and then|and\s+read|read|open|show|here|dont|don't)\b)/i,
    /\b(?:make|set|edit|change|update)\s+(?:the\s+)?codeword\s+(?:to\s+be\s+|to\s+|as\s+|=\s*)?(.+?)(?=$|[.?!,]|\s+(?:then|after that|and then|and\s+read|read|open|show|here|dont|don't)\b)/i,
    /\bcode\s*word\b.*?\b(?:to be|to|as|=)\s+(.+?)(?=$|[.?!,]|\s+(?:then|after that|and then|and\s+read|read|open|show|here|dont|don't)\b)/i,
    /\bcodeword\b.*?\b(?:to be|to|as|=)\s+(.+?)(?=$|[.?!,]|\s+(?:then|after that|and then|and\s+read|read|open|show|here|dont|don't)\b)/i,
  ];

  for (const pattern of patterns) {
    const match = directive.match(pattern);
    const value = cleanCodewordValue(match?.[1] || "");
    if (value && !/^code\s*word\s*:?\s*$/i.test(value)) return value;
  }

  return null;
}

function cleanCodewordValue(value: string) {
  let cleaned = cleanReplacementTerm(value);
  const noOtherWordMatch = cleaned.match(/\bnot\s+any\s+other\s+word\s+but\s+([A-Za-z0-9_-]+)/i);
  if (noOtherWordMatch) return noOtherWordMatch[1];

  const justAloneMatch = cleaned.match(/\bjust\s+([A-Za-z0-9_-]+)\s+alone\b/i);
  if (justAloneMatch) return justAloneMatch[1];

  cleaned = cleaned
    .replace(/^(?:now\s+)?be\s+/i, "")
    .replace(/^now\s+/i, "")
    .replace(/^just\s+/i, "")
    .replace(/^only\s+/i, "")
    .replace(/\s+alone$/i, "")
    .trim();

  const singleToken = cleaned.match(/^[A-Za-z0-9_-]+/);
  return singleToken?.[0] || cleaned;
}

function tryBuildCodewordReplacementContent(directive: string, content: string): CodewordEdit | null {
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

function wantsReadAfterMutation(directive: string) {
  return /\b(?:then|after that|afterwards|and then)\b[\s\S]*\b(read|show|tell me|what.*say|what.*says|content|contents)\b/i.test(directive)
    || /\b(read|show)\b[\s\S]*\b(after|afterwards|then)\b/i.test(directive);
}

function wantsFirstLineOnlyEdit(directive: string) {
  const text = directive.toLowerCase();
  return (
    /\b(remove|delete|clear|trim)\b[\s\S]*\b(everything|all|rest)\b[\s\S]*\b(apart from|except|besides|but|other than)\b[\s\S]*\b(first line|line 1|top line|code\s*word|codeword)\b/.test(text)
    || /\b(keep|leave)\b[\s\S]*\b(only|just)\b[\s\S]*\b(first line|line 1|top line|code\s*word|codeword)\b/.test(text)
    || /\b(remove|delete|clear|trim)\b[\s\S]*\b(after|below|under)\b[\s\S]*\b(first line|line 1|top line)\b/.test(text)
  );
}

function wantsAiAssistedFileEdit(directive: string) {
  const text = directive.toLowerCase();
  if (!wantsEditDirective(directive)) return false;
  if (wantsFirstLineOnlyEdit(directive)) return false;

  const asksForGeneratedContent = /\b(add|append|insert|include|put|write|generate)\b/.test(text)
    && /\b(names?|examples?|shows?|movies?|lines?|below|above|after|before|list|some|few|quotes?|quotas?|emojis?|equations?)\b/.test(text);
  const rewritesWholeFile = /\b(change|replace|rewrite|make|turn)\b/.test(text)
    && /\b(whole file|entire file|file to be|bunch of|set of|list of|math|equations?|emojis?|quotes?|quotas?)\b/.test(text);
  const compoundEdit = /\band\b[\s\S]*\b(add|append|insert|include|put|write|generate|remove|delete|clear|trim)\b/.test(text);
  const positionalEdit = /\b(lines?|below|above|after|before)\b/.test(text);
  const qualitativeRewrite = /\b(more complex|harder|less simple|advanced|simpler|cleaner|better)\b/.test(text);

  return asksForGeneratedContent || rewritesWholeFile || compoundEdit || positionalEdit || qualitativeRewrite;
}

function wantsContextualGeneratedEditFollowup(directive: string, recentUserIntents: string[], hasCurrentTarget: boolean) {
  if (!hasCurrentTarget || wantsFirstLineOnlyEdit(directive)) return false;
  const text = directive.toLowerCase();
  const recentText = recentUserIntents.slice(-6).join("\n").toLowerCase();
  const priorGeneratedEdit = /\b(whole file|bunch of|batch|emojis?|quotes?|quotas?|equations?|math|random)\b/.test(recentText);
  const currentMentionsGeneratedContent = /\b(emojis?|quotes?|quotas?|equations?|math|random)\b/.test(text);
  const contextualFollowup = /\b(new|another|fresh|different|more)\b[\s\S]*\b(batch|set|ones|one|list)\b/.test(text)
    || /\bat\s+least\s+\d+\b/.test(text)
    || /\bminimum\s+of\s+\d+\b/.test(text);

  return (currentMentionsGeneratedContent || contextualFollowup) && (priorGeneratedEdit || currentMentionsGeneratedContent);
}

function isRateLimitedBridgeMessage(message: string) {
  return /Bridge Offline:.*(?:429|rate limit)/i.test(message);
}

function isRecoverableBridgeMessage(message: string) {
  return isRateLimitedBridgeMessage(message)
    || /Bridge Offline|Invalid JSON|Empty response|non-JSON|No parseable JSON/i.test(message);
}

function buildFirstLineOnlyEdit(directive: string, content: string): LocalTextEdit | null {
  if (!wantsFirstLineOnlyEdit(directive)) return null;

  const normalized = normalizeFileWriteContent(stripFileContentWrapper(content));
  const lines = normalized.split(/\r?\n/);
  const wantsCodewordLine = /\bcode\s*word\b|\bcodeword\b/i.test(directive);
  const codewordLine = wantsCodewordLine
    ? lines.find((line) => /^\s*code\s*word\s*[:=-]/i.test(line))
    : undefined;
  if (wantsCodewordLine && !codewordLine) return null;
  const keptLine = codewordLine ?? lines[0] ?? "";

  return {
    content: keptLine,
    description: `Kept only the ${codewordLine ? "codeword line" : "first line"} and removed the remaining content.`,
  };
}

function buildNeutralReadCommandMessage(payload: Record<string, any>) {
  const paths = getReadFilePaths(payload);
  if (paths.length === 0) return "Reading requested file.";
  if (paths.length === 1) return `Reading ${getFileName(paths[0])}.`;
  return `Reading ${paths.length} requested files.`;
}

function getLabeledCodeword(content: string) {
  const cleaned = normalizeFileWriteContent(stripFileContentWrapper(content));
  const labeled = cleaned.match(/^\s*code\s*word\s*[:=-]\s*(.+?)\s*$/im);
  return labeled ? stripFileContentWrapper(labeled[1]).replace(/^["']|["']$/g, "") : "";
}

function stripInvisibleContent(content: string) {
  return normalizeFileWriteContent(stripFileContentWrapper(content))
    .replace(/[\s\u200B-\u200D\u2060\uFEFF\uFE0E\uFE0F]/g, "");
}

function getRequestedMinimumCount(directive: string) {
  const match = directive.match(/\b(?:at least|minimum of)\s+(\d{1,3})\b/i);
  return match ? Math.max(1, Math.min(200, Number(match[1]))) : 0;
}

function getInvalidAiGeneratedContentReason(directive: string, content: string) {
  if (!/\b(emojis?|symbols?|characters?)\b/i.test(directive)) return "";
  const visibleContent = stripInvisibleContent(content);
  if (visibleContent.length === 0) {
    return "The selected AI model returned blank or invisible generated content, so I left the file unchanged.";
  }
  if (/[A-Za-z0-9]/.test(visibleContent)) {
    return "The selected AI model returned non-emoji text for an emoji-only request, so I left the file unchanged.";
  }
  const requestedMinimum = getRequestedMinimumCount(directive);
  if (requestedMinimum > 0 && Array.from(visibleContent).length < requestedMinimum) {
    return `The selected AI model returned fewer visible emoji than requested (${requestedMinimum}), so I left the file unchanged.`;
  }
  return "";
}

function buildFileReadResponse(
  directive: string,
  path: string,
  content: string,
  openedInspector: boolean,
  shouldRedact = false,
  redactor = redactSensitiveContent,
) {
  const fileName = getFileName(path);
  const displayPath = redactor(normalizePathSeparators(path));
  const cleaned = normalizeFileWriteContent(stripFileContentWrapper(content));
  const safeCleaned = redactor(cleaned);

  if (openedInspector && !shouldRedact) {
    return `Opened ${fileName} in Remote_Inspector.\nPath: ${displayPath}`;
  }

  if (shouldRedact) {
    return `I read ${fileName}. Redacted important information:\n\n${safeCleaned || "(empty file)"}`;
  }

  if (isCodewordDirective(directive)) {
    return `The codeword in ${fileName} is: ${extractCodeword(content)}.`;
  }

  return `I read ${fileName}. It says:\n\n${safeCleaned || "(empty file)"}`;
}

function isEmptyBridgeResponse(message: string) {
  return /Bridge Offline:\s*Empty response from Neural Bridge/i.test(message);
}

export function NeuralCommand() {
  const nexus = useNexus();
  const { state, knowledgeGraph, fileTree, systemHealth, systemHealthAverage, url, addManualLog, fileContent, workingDirectory } = nexus;
  
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastAgentReadFile, setLastAgentReadFile] = useState<ReadFileSnapshot | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileEditCacheRef = useRef<Map<string, FileEditSnapshot>>(new Map());
  const lastMutationPathRef = useRef<string | null>(null);
  const codewordHistoryRef = useRef<string[]>([]);
  const revealLocalUserPathsRef = useRef(true);
  const returnInsideFolderRef = useRef<string | null>(null);
  const lastDirectoryNavigationRef = useRef<DirectoryNavigationContext | null>(null);
  const sessionMemoryRef = useRef<SessionMemory>({
    recentFiles: [],
    recentUserIntents: [],
    fileEvents: [],
  });

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

  const displaySensitiveText = (value: string) =>
    revealLocalUserPathsRef.current ? redactHighConfidenceSecrets(value) : redactSensitiveContent(value);

  const trackCodewordValue = (value: string) => {
    const cleaned = cleanCodewordValue(value);
    if (!cleaned) return;
    const previous = codewordHistoryRef.current[codewordHistoryRef.current.length - 1];
    if (previous !== cleaned) {
      codewordHistoryRef.current = [...codewordHistoryRef.current, cleaned];
    }
  };

  const rememberUserIntent = (intent: string) => {
    const trimmed = intent.trim();
    if (!trimmed) return;
    sessionMemoryRef.current = {
      ...sessionMemoryRef.current,
      firstUserIntent: sessionMemoryRef.current.firstUserIntent || trimmed,
      recentUserIntents: trimList([...sessionMemoryRef.current.recentUserIntents, trimmed], 12),
    };
  };

  const rememberFileEvent = (event: string, path: string, content?: string) => {
    const normalizedPath = normalizePathSeparators(path);
    sessionMemoryRef.current = {
      ...sessionMemoryRef.current,
      lastTargetPath: normalizedPath,
      lastFilePreview: content !== undefined ? compactPreview(content) : sessionMemoryRef.current.lastFilePreview,
      recentFiles: trimList(Array.from(new Set([...sessionMemoryRef.current.recentFiles, normalizedPath])), 8),
      fileEvents: trimList([...sessionMemoryRef.current.fileEvents, `${event}: ${getFileName(normalizedPath)}`], 16),
      ...(event === "READ" ? { lastReadPath: normalizedPath } : {}),
      ...(event === "WRITE" ? { lastWritePath: normalizedPath } : {}),
    };
  };

  const buildSessionMemoryText = () => {
    const memory = sessionMemoryRef.current;
    return [
      "SESSION_MEMORY:",
      `First user intent: ${memory.firstUserIntent ? redactSensitiveContent(memory.firstUserIntent) : "None"}`,
      `Last target file: ${memory.lastTargetPath || "None"}`,
      `Last read file: ${memory.lastReadPath || "None"}`,
      `Last written file: ${memory.lastWritePath || "None"}`,
      `Recent files: ${memory.recentFiles.length > 0 ? memory.recentFiles.join(" | ") : "None"}`,
      `Recent user intents: ${memory.recentUserIntents.length > 0 ? memory.recentUserIntents.map(redactSensitiveContent).join(" | ") : "None"}`,
      `File events: ${memory.fileEvents.length > 0 ? memory.fileEvents.join(" | ") : "None"}`,
      `Last file preview:\n"""${memory.lastFilePreview || "None"}"""`,
    ].join("\n");
  };

  const getAiHistory = (history: ChatMessage[], limit = 24) => [
    { role: "model" as const, content: buildSessionMemoryText() },
    ...history.slice(-limit).map((message) => ({
      role: message.role,
      content: redactSensitiveContent(message.content),
    })),
  ];

  const buildCodewordHistoryResponse = () => {
    const values = codewordHistoryRef.current;
    if (values.length === 0) return "I have not tracked any codeword values in this page session yet.";
    return `We have gone through ${values.length} codeword ${values.length === 1 ? "value" : "values"} this page session:\n\n${values.map((value, index) => `${index + 1}. ${value}`).join("\n")}`;
  };

  const getUserMessages = (history: ChatMessage[], includeCurrent = true) => {
    const userMessages = history.filter((message) => message.role === "user");
    return includeCurrent ? userMessages : userMessages.slice(0, -1);
  };

  const buildSessionMessageCountResponse = (history: ChatMessage[]) => {
    const userMessages = getUserMessages(history);
    return [
      `You have sent ${userMessages.length} user ${userMessages.length === 1 ? "message" : "messages"} in this page session.`,
      "",
      ...userMessages.map((message, index) => `${index + 1}. "${redactSensitiveContent(message.content)}"`),
    ].join("\n");
  };

  const buildSessionEditRequestRecallResponse = (history: ChatMessage[]) => {
    const previousUserMessages = getUserMessages(history, false);
    const editRequest = [...previousUserMessages].reverse().find((message) =>
      wantsEditDirective(message.content)
      && !wantsRevertDirective(message.content)
      && /\b(file|txt|text|content|code\s*word|codeword|whole file)\b/i.test(message.content)
    );

    if (!editRequest) return "I do not see an earlier file-edit request in this page session.";
    return `Your file-edit request was:\n\n"${redactSensitiveContent(editRequest.content)}"`;
  };

  const buildSessionActionSummaryResponse = (history: ChatMessage[]) => {
    const previousUserMessages = getUserMessages(history, false);
    if (previousUserMessages.length === 0) return "I do not have earlier user actions in this page session yet.";

    const actionLines = previousUserMessages
      .filter((message) => {
        const content = message.content;
        return wantsFolderInventory(content, history)
          || wantsLocalFileReadRequest(content, history)
          || wantsEditDirective(content)
          || wantsRevertDirective(content)
          || wantsSessionFirstQuestion(content)
          || wantsSessionEditRequestRecall(content)
          || wantsSessionMessageCount(content);
      })
      .map((message, index) => `${index + 1}. "${redactSensitiveContent(message.content)}"`);

    if (actionLines.length === 0) {
      return "I have the chatlog, but I do not see earlier tool/session actions in this page session.";
    }

    return `Here are the action-style requests I have from this page session:\n\n${actionLines.join("\n")}`;
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
    const normalizedContent = normalizeFileWriteContent(content);
    const snapshot = await cacheFileBeforeMutation(path);
    await nexus.writeFile(path, normalizedContent);
    lastMutationPathRef.current = path;
    setLastAgentReadFile({ path, content: normalizedContent });
    rememberFileEvent("WRITE", path, normalizedContent);
    return snapshot;
  };

  const executeDeleteFile = async (path: string) => {
    await cacheFileBeforeMutation(path);
    await nexus.deleteFile(path);
    lastMutationPathRef.current = path;
    setLastAgentReadFile((prev) => prev?.path === path ? null : prev);
  };

  const executeRenameFile = async (fromPath: string, toPath: string) => {
    const snapshot = await cacheFileBeforeMutation(fromPath);
    await nexus.renameFile(fromPath, toPath);
    lastMutationPathRef.current = toPath;
    if (snapshot.content !== null) {
      setLastAgentReadFile({ path: toPath, content: snapshot.content });
      rememberFileEvent("RENAME", toPath, snapshot.content);
    } else {
      setLastAgentReadFile((prev) => prev?.path === fromPath ? { ...prev, path: toPath } : prev);
      rememberFileEvent("RENAME", toPath);
    }
    return snapshot;
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
        `Restored ${getFileName(snapshot.path)} to its cached previous state.\nPath: ${displaySensitiveText(normalizePathSeparators(snapshot.path))}`,
        "WRITE_FILE",
      );
    }

    if (wantsDeleteWithoutConfirmation(input)) {
      await executeDeleteFile(snapshot.path);
      return appendModelMessage(history, buildFileDeleteResponse(snapshot.path, displaySensitiveText), "DELETE_FILE");
    }

    setPendingDelete({
      path: snapshot.path,
      message: `Reverting this session-created file requires deleting it.\n\nTarget: ${displaySensitiveText(normalizePathSeparators(snapshot.path))}`,
    });
    return appendModelMessage(
      history,
      buildDeleteConfirmationMessage(snapshot.path, displaySensitiveText),
      "DELETE_FILE",
    );
  };

  const resolveCurrentFileTarget = (input: string, history: ChatMessage[]) => {
    const explicitPath = getRequestedFilePaths(input, history, fileTree)[0];
    const inferredPath = inferReadPathsFromContext(input, history, fileTree)[0];
    const fallbackPath = explicitPath
      || lastAgentReadFile?.path
      || fileContent?.path
      || inferredPath
      || sessionMemoryRef.current.lastTargetPath
      || sessionMemoryRef.current.lastWritePath
      || sessionMemoryRef.current.lastReadPath
      || "";
    return fallbackPath ? resolveCommandPath(fallbackPath, input, history) : "";
  };

  const resolveRenameSourcePath = (input: string, history: ChatMessage[], destinationName: string) => {
    const destinationLower = getFileName(destinationName).toLowerCase();
    const explicitSourceName = getExplicitFileNames(input).find((name) => name !== destinationLower);
    if (explicitSourceName) {
      const nodes = flattenFileTree(fileTree);
      const match = nodes.find((node) => {
        if (!isFileNode(node) || typeof node.path !== "string") return false;
        const nodeName = String(node.name || getFileName(node.path)).toLowerCase();
        return nodeName === explicitSourceName;
      });
      if (match?.path) return resolveCommandPath(match.path, input, history);
    }

    const fallbackPath = lastAgentReadFile?.path
      || fileContent?.path
      || sessionMemoryRef.current.lastTargetPath
      || sessionMemoryRef.current.lastReadPath
      || sessionMemoryRef.current.lastWritePath
      || "";

    return fallbackPath ? resolveCommandPath(fallbackPath, input, history) : "";
  };

  const handleRenameFileRequest = async (input: string, history: ChatMessage[]) => {
    const destinationName = getRenameDestinationName(input);
    if (!destinationName) {
      return appendModelMessage(history, "I need the new file name before I can rename it.");
    }

    const fromPath = resolveRenameSourcePath(input, history, destinationName);
    if (!fromPath) {
      return appendModelMessage(history, "I need a current or explicitly named source file before I can rename it.");
    }

    const toPath = buildSiblingRenamePath(fromPath, destinationName);
    if (!toPath) {
      return appendModelMessage(history, "I could not build a valid destination path for that rename.");
    }

    if (normalizePathSeparators(fromPath).toLowerCase() === normalizePathSeparators(toPath).toLowerCase()) {
      return appendModelMessage(history, `${getFileName(fromPath)} already has that name.`);
    }

    try {
      await executeRenameFile(fromPath, toPath);
      return appendModelMessage(history, buildFileRenameResponse(fromPath, toPath, displaySensitiveText), "RENAME_FILE");
    } catch (error: any) {
      const message = error.message || "Unknown error";
      const alreadyExists = /409|already exists/i.test(message);
      return appendModelMessage(
        history,
        alreadyExists
          ? `I could not rename ${getFileName(fromPath)} to ${getFileName(toPath)} because the destination already exists. Choose another name, or delete/rename the existing ${getFileName(toPath)} first.`
          : `Rename failed: ${message}`,
        "RENAME_FILE",
      );
    }
  };

  const handleFolderOnlyListingRequest = async (input: string, history: ChatMessage[]) => {
    const currentRoot = getCurrentTreeRootPath(fileTree, workingDirectory);
    const fallbackPath = getFallbackDirectoryTarget(input, fileTree, workingDirectory);
    let targetPath = "";

    try {
      const result = await nexusCommand({
        prompt: buildDirectoryResolverPrompt({
          directive: input,
          fileTree,
          currentRoot,
          workingDirectory,
        }),
        history: getAiHistory(history, 18),
        context: {
          processes: [],
          fileTree: fileTree || [],
          systemHealth: systemHealth || {},
          currentUrl: url,
          workingDirectory: currentRoot || workingDirectory || "C:/",
        },
      });

      if (result.command === "SET_PATH") {
        targetPath = getDirectoryPathFromCommandResult(result);
        addManualLog("AI_DIRECTORY_RESOLVER", targetPath || "No SET_PATH payload returned");
      } else if (result.command === "READ_FILE") {
        addManualLog("SECURITY", "Suppressed READ_FILE from directory resolver");
      } else if (isRecoverableBridgeMessage(result.message)) {
        addManualLog("AI_DIRECTORY_RESOLVER", result.message);
      }
    } catch (error: any) {
      addManualLog("AI_DIRECTORY_RESOLVER", `Resolver fault: ${error.message || "Unknown error"}`);
    }

    targetPath = normalizePathSeparators(targetPath || fallbackPath).replace(/\/+$/, "");

    if (targetPath) {
      try {
        const response = await nexus.sendCommand("SET_PATH", { path: targetPath, depth: 1 });
        const { tree, path } = extractTreePayload(response);
        const label = path ? displaySensitiveText(normalizePathSeparators(path)) : displaySensitiveText(targetPath);
        return appendModelMessage(history, buildFolderOnlyResponse(tree, label));
      } catch (error: any) {
        return appendModelMessage(history, `I could not list folders there: ${error.message || "Unknown error"}`);
      }
    }

    return appendModelMessage(history, buildFolderOnlyResponse(fileTree, "the current Recursive Mirror root"));
  };

  const executeDirectorySetPath = async (
    input: string,
    history: ChatMessage[],
    targetPath: string,
    fromPath: string,
    foldersBefore: FileTreeNode[],
  ) => {
    const response = await nexus.sendCommand("SET_PATH", { path: targetPath, depth: 1 });
    const { path } = extractTreePayload(response);
    const resolvedTarget = normalizePathSeparators(path || targetPath).replace(/\/+$/, "");

    lastDirectoryNavigationRef.current = {
      directive: input,
      fromPath,
      toPath: resolvedTarget,
      foldersBefore,
    };

    if (fromPath && getParentPath(fromPath).toLowerCase() === resolvedTarget.toLowerCase()) {
      returnInsideFolderRef.current = fromPath;
    } else if (
      returnInsideFolderRef.current
      && normalizePathSeparators(returnInsideFolderRef.current).replace(/\/+$/, "").toLowerCase() === resolvedTarget.toLowerCase()
    ) {
      returnInsideFolderRef.current = null;
    }

    return appendModelMessage(
      history,
      buildDirectorySetPathResponse(response, targetPath, displaySensitiveText),
      "SET_PATH",
    );
  };

  const handleDirectoryNavigationRequest = async (input: string, history: ChatMessage[], preResolvedTarget = "") => {
    const currentRoot = getCurrentTreeRootPath(fileTree, workingDirectory);
    const foldersBefore = getDirectFolderNodes(fileTree);
    const parentThenChild = getParentThenChildNavigationTarget(input, fileTree, workingDirectory);

    if (parentThenChild && typeof parentThenChild === "object") {
      try {
        const parentResponse = await nexus.sendCommand("SET_PATH", { path: parentThenChild.parentPath, depth: 1 });
        const { tree, path } = extractTreePayload(parentResponse);
        const parentPath = normalizePathSeparators(path || parentThenChild.parentPath).replace(/\/+$/, "");
        const childPath = resolveDirectoryPathCandidate(parentThenChild.query, tree, parentPath);
        if (!childPath) {
          return appendModelMessage(history, buildDirectorySetPathResponse(parentResponse, parentPath, displaySensitiveText), "SET_PATH");
        }
        return executeDirectorySetPath(input, history, childPath, parentPath, getDirectFolderNodes(tree));
      } catch (error: any) {
        return appendModelMessage(history, `I could not navigate there: ${error.message || "Unknown error"}`, "SET_PATH");
      }
    }

    const targetPath = preResolvedTarget || getDirectoryNavigationTarget(
      input,
      fileTree,
      workingDirectory,
      returnInsideFolderRef.current || "",
      lastDirectoryNavigationRef.current,
    );
    if (!targetPath) {
      return appendModelMessage(history, "I could not resolve the folder to navigate to.");
    }

    try {
      return executeDirectorySetPath(input, history, targetPath, currentRoot, foldersBefore);
    } catch (error: any) {
      return appendModelMessage(history, `I could not navigate there: ${error.message || "Unknown error"}`, "SET_PATH");
    }
  };

  const wantsLocalFileReadRequest = (input: string, history: ChatMessage[]) => {
    if (wantsEditDirective(input) || wantsDeleteDirective(input) || wantsFolderInventory(input, history) || wantsWorkspaceInventory(input) || wantsFolderOnlyListing(input, history)) return false;
    const text = input.toLowerCase();
    const asksForFileContent = /\b(read|what.*say|what.*says|what.*in|content|contents)\b/.test(text)
      || /\bwhat(?:'s| is)?\s+in\b/.test(text)
      || wantsExplicitOpen(input);
    const mentionsFile = hasFileReference(input) || /\b(that|current|now|after|updated)\b/.test(text);
    return asksForFileContent && mentionsFile;
  };

  const handleLocalFileReadRequest = async (input: string, history: ChatMessage[]) => {
    const targetPath = resolveCurrentFileTarget(input, history);
    if (!targetPath) return null;

    const shouldRedactRead = shouldRedactForTurn(input, history);
    const openInspector = wantsInspectorOpen(input, {}, shouldRedactRead);
    let nextHistory = appendModelMessage(history, `Reading ${getFileName(targetPath)}.`, "READ_FILE");
    const content = await nexus.readFile(targetPath, { openInspector });
    if (content === null) {
      return appendModelMessage(nextHistory, `I could not read ${getFileName(targetPath)}.`);
    }

    const codeword = getLabeledCodeword(content);
    if (codeword) trackCodewordValue(codeword);

    setLastAgentReadFile({ path: targetPath, content });
    rememberFileEvent("READ", targetPath, content);
    nextHistory = appendModelMessage(
      nextHistory,
      buildFileReadResponse(input, targetPath, content, openInspector, shouldRedactRead, displaySensitiveText),
    );
    return nextHistory;
  };

  const handleCodewordEditRequest = async (input: string, history: ChatMessage[]) => {
    const targetPath = resolveCurrentFileTarget(input, history);
    if (!targetPath) {
      return appendModelMessage(
        history,
        "I need a target file before I can update the codeword.",
      );
    }

    const currentContent = await nexus.readFile(targetPath, { openInspector: false });
    if (currentContent === null) {
      return appendModelMessage(history, `I could not read ${getFileName(targetPath)} before editing it.`);
    }

    const codewordEdit = tryBuildCodewordReplacementContent(input, currentContent);
    if (!codewordEdit) {
      return appendModelMessage(history, "I could not identify the new codeword value, so I left the file unchanged.");
    }

    const snapshot = await executeWriteFile(targetPath, codewordEdit.content);
    trackCodewordValue(codewordEdit.codeword);
    let nextHistory = appendModelMessage(
      history,
      `Updated the codeword to "${codewordEdit.codeword}" in ${getFileName(targetPath)}.\n${buildFileWriteResponse(targetPath, codewordEdit.content, snapshot.existed, displaySensitiveText)}`,
      "WRITE_FILE",
    );

    if (wantsReadAfterMutation(input)) {
      const codeword = getLabeledCodeword(codewordEdit.content);
      if (codeword) trackCodewordValue(codeword);
      nextHistory = appendModelMessage(
        nextHistory,
        buildFileReadResponse("read the file", targetPath, codewordEdit.content, false, shouldRedactForTurn(input, history), displaySensitiveText),
      );
    }

    return nextHistory;
  };

  const handleLocalTextEditRequest = async (input: string, history: ChatMessage[]) => {
    const targetPath = resolveCurrentFileTarget(input, history);
    if (!targetPath) {
      return appendModelMessage(
        history,
        "I need a target file before I can edit its text.",
      );
    }

    const currentContent = await nexus.readFile(targetPath, { openInspector: false });
    if (currentContent === null) {
      return appendModelMessage(history, `I could not read ${getFileName(targetPath)} before editing it.`);
    }

    const edit = buildFirstLineOnlyEdit(input, currentContent);
    if (!edit) {
      if (/\bcode\s*word\b|\bcodeword\b/i.test(input)) {
        return appendModelMessage(
          history,
          `I did not find a Codeword line in ${getFileName(targetPath)}, so I left the file unchanged.`,
        );
      }
      return null;
    }

    const snapshot = await executeWriteFile(targetPath, edit.content);
    const codeword = getLabeledCodeword(edit.content);
    if (codeword) trackCodewordValue(codeword);

    let nextHistory = appendModelMessage(
      history,
      `${edit.description}\n${buildFileWriteResponse(targetPath, edit.content, snapshot.existed, displaySensitiveText)}`,
      "WRITE_FILE",
    );

    if (wantsReadAfterMutation(input)) {
      nextHistory = appendModelMessage(
        nextHistory,
        buildFileReadResponse("read the file", targetPath, edit.content, false, shouldRedactForTurn(input, history), displaySensitiveText),
      );
    }

    return nextHistory;
  };

  const handleAiAssistedFileEditRequest = async (input: string, history: ChatMessage[]) => {
    const targetPath = resolveCurrentFileTarget(input, history);
    const contextualDirective = `${sessionMemoryRef.current.recentUserIntents.slice(-6).join("\n")}\n${input}`;
    if (!targetPath) {
      return appendModelMessage(
        history,
        "I need a target file before I can apply that edit.",
      );
    }

    const currentContent = await nexus.readFile(targetPath, { openInspector: false });
    if (currentContent === null) {
      return appendModelMessage(history, `I could not read ${getFileName(targetPath)} before editing it.`);
    }

    const transformPrompt = `SYSTEM_FEEDBACK: AI_ASSISTED_FILE_EDIT
TARGET_FILE: ${targetPath}
CURRENT_CONTENT:
"""
${normalizeFileWriteContent(currentContent)}
"""

USER_DIRECTIVE:
"""
${input}
"""

Resolve short follow-up directives from HISTORY and SESSION_MEMORY. If the user asks for a new batch/set/ones, apply that to TARGET_FILE using the most recent generated-content request.
Produce the complete replacement content for TARGET_FILE. Return WRITE_FILE with payload.path exactly TARGET_FILE and payload.content containing the full new file content. Preserve any existing content the user did not ask to remove. Do not ask for another read. Do not open the inspector.
For emoji-only requests, payload.content must contain visible emoji only plus whitespace/newlines. Do not include words, URLs, provider names, punctuation labels, or hidden/invisible-only output. Honor requested counts such as "at least 50".`;

    const result = await nexusCommand({
      prompt: transformPrompt,
      history: getAiHistory(history, 18),
      context: {
        processes: knowledgeGraph?.nodes || [],
        fileTree: fileTree || [],
        systemHealth: systemHealth || {},
        currentUrl: url,
        workingDirectory: workingDirectory || "C:/",
        lastReadFile: { path: targetPath, content: currentContent },
      },
    });

    const payload = result.payload || {};
    if (result.command !== "WRITE_FILE" && isRecoverableBridgeMessage(result.message)) {
      return appendModelMessage(
        history,
        `The AI bridge could not produce replacement content for ${getFileName(targetPath)} (${humanizeModelMessage(result.message, true, displaySensitiveText)}). I left the file unchanged.`,
      );
    }

    if (result.command !== "WRITE_FILE" || !payloadHasWriteContent(payload)) {
      return appendModelMessage(
        history,
        "I could not produce a complete replacement for that edit, so I left the file unchanged.",
      );
    }

    const content = getWriteFileContent(payload);
    const invalidGeneratedContentReason = getInvalidAiGeneratedContentReason(contextualDirective, content);
    if (invalidGeneratedContentReason) {
      return appendModelMessage(history, invalidGeneratedContentReason);
    }

    const snapshot = await executeWriteFile(targetPath, content);
    const codeword = getLabeledCodeword(content);
    if (codeword) trackCodewordValue(codeword);

    let nextHistory = appendModelMessage(
      history,
      `Applied the AI-assisted edit to ${getFileName(targetPath)}.\n${buildFileWriteResponse(targetPath, content, snapshot.existed, displaySensitiveText)}`,
      "WRITE_FILE",
    );

    if (wantsReadAfterMutation(input)) {
      nextHistory = appendModelMessage(
        nextHistory,
        buildFileReadResponse("read the file", targetPath, content, false, shouldRedactForTurn(input, history), displaySensitiveText),
      );
    }

    return nextHistory;
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
          content: buildFileDeleteResponse(deletePath, displaySensitiveText),
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
      rememberUserIntent(input);
      setMessages([...localHistory]);
    }

    if (!isSilent && wantsLocalPathRedaction(input)) {
      revealLocalUserPathsRef.current = false;
      appendModelMessage(
        localHistory,
        "Understood. I will redact local user path names again, while still redacting secrets either way.",
      );
      return;
    }

    if (!isSilent && wantsLocalPathUnredaction(input)) {
      revealLocalUserPathsRef.current = true;
      const hasFollowupRequest = wantsCurrentFolderQuestion(input)
        || wantsWorkspaceInventory(input)
        || wantsFolderOnlyListing(input, localHistory)
        || wantsFolderInventory(input, localHistory)
        || wantsDirectoryNavigation(input)
        || wantsLocalFileReadRequest(input, localHistory)
        || wantsEditDirective(input)
        || wantsDeleteDirective(input)
        || wantsRenameFileDirective(input);
      if (!hasFollowupRequest) {
        appendModelMessage(
          localHistory,
          "Understood. I will show local user path names in this page session, while still redacting secrets.",
        );
        return;
      }
    }

    if (!isSilent && wantsSessionFirstQuestion(input)) {
      appendModelMessage(
        localHistory,
        buildSessionFirstQuestionResponse(getFirstUserQuestion(historySeed) || sessionMemoryRef.current.firstUserIntent || input),
      );
      return;
    }

    if (!isSilent && wantsSessionMemoryComplaint(input)) {
      appendModelMessage(
        localHistory,
        sessionMemoryRef.current.firstUserIntent
          ? `I do have this page-session chatlog. The first thing you asked was:\n\n"${redactSensitiveContent(sessionMemoryRef.current.firstUserIntent)}"`
          : "I do not have an earlier user request in this page session yet.",
      );
      return;
    }

    if (!isSilent && wantsToolMisfireComplaint(input)) {
      appendModelMessage(
        localHistory,
        "You're right. That should have stayed conversational/session-scoped and should not have touched file tools.",
      );
      return;
    }

    if (!isSilent && wantsSessionMessageCount(input)) {
      appendModelMessage(localHistory, buildSessionMessageCountResponse(localHistory));
      return;
    }

    if (!isSilent && wantsSessionEditRequestRecall(input)) {
      appendModelMessage(localHistory, buildSessionEditRequestRecallResponse(localHistory));
      return;
    }

    if (!isSilent && wantsSessionActionSummary(input)) {
      appendModelMessage(localHistory, buildSessionActionSummaryResponse(localHistory));
      return;
    }

    if (!isSilent && wantsCodewordHistoryQuestion(input)) {
      appendModelMessage(localHistory, buildCodewordHistoryResponse());
      return;
    }

    if (!isSilent && wantsStatusNudge(input)) {
      appendModelMessage(
        localHistory,
        sessionMemoryRef.current.lastTargetPath
          ? `I still have the current file context as ${getFileName(sessionMemoryRef.current.lastTargetPath)}. Last operation: ${sessionMemoryRef.current.fileEvents.at(-1) || "none"}.`
          : "I do not have an active file operation to continue yet.",
      );
      return;
    }

    // Casual chat / greetings now route through NVIDIA so replies feel like the agent talking,
    // not a canned line.

    const visibleDirectoryNavigationTarget = getDirectoryNavigationTarget(
      input,
      fileTree,
      workingDirectory,
      returnInsideFolderRef.current || "",
      lastDirectoryNavigationRef.current,
    );

    if (!isSilent && (wantsDirectoryNavigation(input) || visibleDirectoryNavigationTarget)) {
      setIsLoading(true);
      try {
        await handleDirectoryNavigationRequest(input, localHistory, visibleDirectoryNavigationTarget);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Folder/workspace inventory and "what folder am I in" prompts now route through NVIDIA.
    // The directory tree + workspace are already supplied as system-prompt context, so the LLM
    // describes them in its own words instead of dumping a hardcoded "I can see these folders" list.

    if (!isSilent && wantsCorrectionOnly(input)) {
      addManualLog("NEURAL", "Handled correction locally without calling Neural Bridge");
      appendModelMessage(
        localHistory,
        "You're right. That should have stayed scoped to the single file you named. I will only read the explicitly requested file for requests like that.",
      );
      return;
    }

    if (!isSilent && wantsRenameFileDirective(input)) {
      setIsLoading(true);
      try {
        await handleRenameFileRequest(input, localHistory);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const hasCurrentFileTarget = Boolean(
      lastAgentReadFile?.path
      || fileContent?.path
      || sessionMemoryRef.current.lastTargetPath
      || sessionMemoryRef.current.lastReadPath
      || sessionMemoryRef.current.lastWritePath
    );

    if (!isSilent && wantsFirstLineOnlyEdit(input)) {
      setIsLoading(true);
      try {
        const handledHistory = await handleLocalTextEditRequest(input, localHistory);
        if (handledHistory) return;
      } catch (error: any) {
        const errorMsg = `Text edit failed: ${error.message || "Unknown error"}`;
        setMessages(prev => [...prev, { role: 'model', content: errorMsg, timestamp: Date.now() }]);
        addManualLog("ERROR", errorMsg);
        return;
      } finally {
        setIsLoading(false);
      }
    }

    if (!isSilent && (wantsAiAssistedFileEdit(input) || wantsContextualGeneratedEditFollowup(input, sessionMemoryRef.current.recentUserIntents, hasCurrentFileTarget))) {
      setIsLoading(true);
      try {
        await handleAiAssistedFileEditRequest(input, localHistory);
      } catch (error: any) {
        const errorMsg = `AI file edit failed: ${error.message || "Unknown error"}`;
        setMessages(prev => [...prev, { role: 'model', content: errorMsg, timestamp: Date.now() }]);
        addManualLog("ERROR", errorMsg);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // File-read directives always route through the NVIDIA bridge; no local short-circuit.

    if (!isSilent && parseCodewordAssignment(input) && wantsEditDirective(input)) {
      setIsLoading(true);
      try {
        await handleCodewordEditRequest(input, localHistory);
      } catch (error: any) {
        const errorMsg = `Codeword edit failed: ${error.message || "Unknown error"}`;
        setMessages(prev => [...prev, { role: 'model', content: errorMsg, timestamp: Date.now() }]);
        addManualLog("ERROR", errorMsg);
      } finally {
        setIsLoading(false);
      }
      return;
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
      const conversationHistory = getAiHistory(localHistory, 24);
      const contextReadFileSource = readFileOverride || lastAgentReadFile || fileContent || undefined;
      const contextReadFile = contextReadFileSource
        ? {
            path: contextReadFileSource.path,
            content: redactSensitiveContent(contextReadFileSource.content),
          }
        : undefined;

      let result = await nexusCommand({
        prompt: input,
        history: conversationHistory,
        context: {
          processes: knowledgeGraph?.nodes || [],
          fileTree: fileTree || [],
          systemHealth: systemHealth || {},
          systemHealthAverage: systemHealthAverage || undefined,
          connectionState: state,
          currentUrl: url,
          workingDirectory: workingDirectory || "C:/",
          lastReadFile: contextReadFile
        }
      });
      // NVIDIA is the sole intent decider — no local synthesis of READ_FILE intent here.
      const explicitlyRequestedFilePaths = getRequestedFilePaths(rootDirective, localHistory, fileTree);
      if (result.command === "READ_FILE" && explicitlyRequestedFilePaths.length > 0) {
        const clampedPaths = explicitlyRequestedFilePaths.slice(0, 5);
        result = {
          ...result,
          thought: `${result.thought || "Reading file."} Clamped READ_FILE to explicitly requested filename(s).`,
          payload: clampedPaths.length > 1 ? { paths: clampedPaths } : { path: clampedPaths[0] },
          message: clampedPaths.length > 1
            ? `Reading ${clampedPaths.length} explicitly requested files.`
            : `Reading ${getFileName(clampedPaths[0])}.`,
        };
      }

      if (result.command !== "SET_PATH") {
        const modelMsg: ChatMessage = {
          role: 'model',
          content: result.command === "READ_FILE"
            ? buildNeutralReadCommandMessage(result.payload || {})
            : humanizeModelMessage(result.message, shouldRedactTurn, displaySensitiveText),
          command: result.command !== "NONE" ? result.command : undefined,
          timestamp: Date.now()
        };

        localHistory = [...localHistory, modelMsg];
        setMessages([...localHistory]);
      }

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
      const allowSilentRename = result.command === "RENAME_FILE"
        && wantsRenameFileDirective(rootDirective)
        && readDepth < 4;
      if (isSilent && result.command !== "NONE" && !allowSilentFollowupRead && !allowSilentWrite && !allowSilentDelete && !allowSilentRename) {
        addManualLog("SECURITY", `Suppressed ${result.command} from file-derived AI context`);
        return;
      }

      // --- SYNCHRONOUS HANDSHAKE LOOP ---
      if (result.command === "READ_FILE") {
        const readPathSet = new Set<string>(
          getReadFilePaths(result.payload || {})
            .map((path) => resolveCommandPath(path, rootDirective, localHistory))
            .filter(Boolean)
        );
        // NVIDIA decides which paths to read; no local augmentation of the path set here.
        const readPaths = constrainPathsToExplicitFiles(
          constrainPathsToRequestedFolder(Array.from(readPathSet), rootDirective, localHistory, fileTree),
          rootDirective,
          localHistory,
          fileTree
        );
        if (readPaths.length === 0) return;

        const openInspector = readPaths.length === 1 && wantsInspectorOpen(rootDirective, result.payload, shouldRedactTurn);
        const readSnapshots: ReadFileSnapshot[] = [];
        try {
          for (const readPath of readPaths.slice(0, 5)) {
            addManualLog("COMMAND", `Executing READ_FILE: ${readPath}`);
            const content = await nexus.readFile(readPath, { openInspector });
            if (content === null) continue;

            const readSnapshot = { path: readPath, content };
            const codeword = getLabeledCodeword(content);
            if (codeword) trackCodewordValue(codeword);
            readSnapshots.push(readSnapshot);
            setLastAgentReadFile(readSnapshot);
            rememberFileEvent("READ", readPath, content);
            if (openInspector) {
              const readResponse: ChatMessage = {
                role: 'model',
                content: buildFileReadResponse(rootDirective, readPath, content, openInspector, shouldRedactTurn, displaySensitiveText),
                timestamp: Date.now()
              };
              localHistory = [...localHistory, readResponse];
              setMessages([...localHistory]);
            }
          }

          const lastReadSnapshot = readSnapshots[readSnapshots.length - 1];
          if (!lastReadSnapshot) return;

          if (!openInspector && readSnapshots.length === 1 && wantsEditDirective(rootDirective)) {
            const codewordEdit = tryBuildCodewordReplacementContent(rootDirective, lastReadSnapshot.content);
            if (codewordEdit) {
              const snapshot = await executeWriteFile(lastReadSnapshot.path, codewordEdit.content);
              localHistory = appendModelMessage(
                localHistory,
                `Updated the codeword to "${codewordEdit.codeword}" in ${getFileName(lastReadSnapshot.path)}.\n${buildFileWriteResponse(lastReadSnapshot.path, codewordEdit.content, snapshot.existed, displaySensitiveText)}`,
                "WRITE_FILE",
              );
              return;
            }

            const simpleEdit = tryBuildSimpleReplacementContent(rootDirective, lastReadSnapshot.content);
            if (simpleEdit) {
              const snapshot = await executeWriteFile(lastReadSnapshot.path, simpleEdit.content);
              localHistory = appendModelMessage(
                localHistory,
                `Replaced "${simpleEdit.from}" with "${simpleEdit.to}" in ${getFileName(lastReadSnapshot.path)}.\n${buildFileWriteResponse(lastReadSnapshot.path, simpleEdit.content, snapshot.existed, displaySensitiveText)}`,
                "WRITE_FILE",
              );
              return;
            }
          }

          // After a successful read, always hand the content back to NVIDIA so the LLM
          // formulates the user-facing answer. Only short-circuit when the file was
          // routed to Remote_Inspector — the inspector view IS the answer there.
          if (openInspector) {
            return;
          }

          const feedbackContent = readSnapshots
            .map((snapshot) => `FILE: ${snapshot.path}\nCONTENT:\n"""\n${redactSensitiveContent(snapshot.content)}\n"""`)
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
          case "SET_PATH": {
            const rawPath = getDirectoryPathFromCommandResult({ command: result.command, payload: result.payload || {} });
            const targetPath = rawPath ? resolveDirectoryPathCandidate(rawPath, fileTree, workingDirectory) : "";
            if (!targetPath) {
              localHistory = appendModelMessage(localHistory, "I need a target folder before I can navigate.", "SET_PATH");
              break;
            }
            const currentRoot = getCurrentTreeRootPath(fileTree, workingDirectory);
            localHistory = await executeDirectorySetPath(rootDirective, localHistory, targetPath, currentRoot, getDirectFolderNodes(fileTree));
            break;
          }
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
            const content = normalizeFileWriteContent(codewordEdit?.content || modelContent);
            await nexus.writeFile(writePath, content);
            lastMutationPathRef.current = writePath;
            setLastAgentReadFile({ path: writePath, content });
            rememberFileEvent("WRITE", writePath, content);
            if (codewordEdit) trackCodewordValue(codewordEdit.codeword);
            localHistory = appendModelMessage(
              localHistory,
              codewordEdit
                ? `Updated the codeword to "${codewordEdit.codeword}" in ${getFileName(writePath)}.\n${buildFileWriteResponse(writePath, content, snapshot.existed, displaySensitiveText)}`
                : buildFileWriteResponse(writePath, content, snapshot.existed, displaySensitiveText),
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
              localHistory = appendModelMessage(localHistory, buildFileDeleteResponse(deletePath, displaySensitiveText), "DELETE_FILE");
            } else {
              setPendingDelete({
                path: deletePath,
                message: buildDeleteConfirmationMessage(deletePath, displaySensitiveText),
              });
              localHistory = appendModelMessage(localHistory, buildDeleteConfirmationMessage(deletePath, displaySensitiveText), "DELETE_FILE");
            }
            break;
          }
          case "RENAME_FILE": {
            const payload = result.payload || {};
            const rawFromPath = getRenameFromPath(payload, lastAgentReadFile?.path || fileContent?.path || "");
            const fromPath = rawFromPath ? resolveCommandPath(rawFromPath, rootDirective, localHistory) : "";
            const rawToPath = getRenameToPath(payload) || getRenameDestinationName(rootDirective);
            const toPath = fromPath && rawToPath
              ? buildSiblingRenamePath(fromPath, rawToPath)
              : "";
            if (!fromPath || !toPath) {
              localHistory = appendModelMessage(localHistory, "I need both source and destination paths before I can rename the file.", "RENAME_FILE");
              break;
            }
            try {
              await executeRenameFile(fromPath, toPath);
              localHistory = appendModelMessage(localHistory, buildFileRenameResponse(fromPath, toPath, displaySensitiveText), "RENAME_FILE");
            } catch (error: any) {
              const message = error.message || "Unknown error";
              localHistory = appendModelMessage(localHistory, `Rename failed: ${message}`, "RENAME_FILE");
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

  const [copiedTranscript, setCopiedTranscript] = useState(false);

  const buildTranscript = () => {
    if (messages.length === 0) return "";
    const lines: string[] = [
      `Council HUD — Nexus conversation`,
      `Exported: ${new Date().toISOString()}`,
      `Messages: ${messages.length}`,
      "",
    ];
    for (const msg of messages) {
      const speaker = msg.role === "model" ? "NEXUS" : "USER";
      const stamp = new Date(msg.timestamp).toISOString();
      const cmd = msg.command ? ` [${msg.command}]` : "";
      lines.push(`--- ${speaker}${cmd} @ ${stamp} ---`);
      lines.push(msg.content);
      lines.push("");
    }
    return lines.join("\n");
  };

  const handleCopyConversation = async () => {
    const transcript = buildTranscript();
    if (!transcript) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(transcript);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = transcript;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedTranscript(true);
      addManualLog("NEURAL", `Copied Nexus transcript (${messages.length} msgs)`);
      setTimeout(() => setCopiedTranscript(false), 1500);
    } catch (error: any) {
      addManualLog("ERROR", `Copy failed: ${error?.message || "Unknown error"}`);
    }
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
        headerAction={
          <>
            <button
              type="button"
              onClick={handleCopyConversation}
              disabled={messages.length === 0}
              title={messages.length === 0 ? "No conversation to copy yet" : `Copy ${messages.length} message${messages.length === 1 ? "" : "s"}`}
              aria-label="Copy Nexus conversation"
              className="flex h-7 items-center gap-1 rounded border border-white/10 bg-black/30 px-2 text-[9px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-black/30 disabled:hover:text-muted-foreground"
            >
              {copiedTranscript ? <Check className="h-3 w-3 text-secondary" /> : <Copy className="h-3 w-3" />}
              <span>{copiedTranscript ? "Copied" : "Copy Log"}</span>
            </button>
            <Sparkles className={cn("w-4 h-4", isLoading ? "text-primary animate-spin" : "text-secondary")} />
          </>
        }
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
