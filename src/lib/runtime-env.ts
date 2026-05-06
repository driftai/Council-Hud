import fs from "node:fs";
import path from "node:path";

const LOCAL_ENV_FILE = path.join(process.cwd(), ".env.local");

function parseEnvFile(filePath: string) {
  const values: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return values;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    values[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
  }

  return values;
}

function serializeEnvValue(value: string) {
  if (/[\r\n]/.test(value)) {
    throw new Error("Environment values cannot contain newlines.");
  }

  return value.trim();
}

export function getRuntimeEnvValue(key: string) {
  const fileValues = parseEnvFile(LOCAL_ENV_FILE);
  return fileValues[key] || process.env[key] || "";
}

export function hasRuntimeEnvValue(key: string) {
  return Boolean(getRuntimeEnvValue(key));
}

export function setRuntimeEnvValue(key: string, value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error("Invalid environment key name.");
  }

  const serializedValue = serializeEnvValue(value);
  const nextLine = `${key}=${serializedValue}`;
  const existing = fs.existsSync(LOCAL_ENV_FILE)
    ? fs.readFileSync(LOCAL_ENV_FILE, "utf8").split(/\r?\n/)
    : [];

  let found = false;
  const nextLines = existing.map((line) => {
    if (line.match(new RegExp(`^\\s*${key}\\s*=`))) {
      found = true;
      return nextLine;
    }
    return line;
  });

  if (!found) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(nextLine);
  }

  fs.writeFileSync(LOCAL_ENV_FILE, nextLines.join("\n").replace(/\n{3,}/g, "\n\n"), {
    encoding: "utf8",
    mode: 0o600,
  });
  process.env[key] = serializedValue;
}

export function getRuntimeTextValue(key: string) {
  const encoded = getRuntimeEnvValue(`${key}_B64`);
  if (!encoded) return "";

  try {
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

export function setRuntimeTextValue(key: string, value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error("Invalid environment key name.");
  }

  const encoded = Buffer.from(value, "utf8").toString("base64");
  setRuntimeEnvValue(`${key}_B64`, encoded);
}
