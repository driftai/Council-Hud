
import fs from 'node:fs';
import pathModule from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const DEFAULT_NEXUS_TARGET = 'http://127.0.0.1:3001';
const PROXY_TIMEOUT_MS = Number(process.env.NEXUS_PROXY_TIMEOUT_MS || 10000);
const PROXY_BODY_LIMIT = Number(process.env.NEXUS_PROXY_BODY_LIMIT_BYTES || 10 * 1024 * 1024);
const LOCAL_KEY_PATH = pathModule.join(process.cwd(), 'Council-Data-Router', 'nexus.key');

/**
 * Nexus Proxy Fortress V110
 * - Resolves CORS and Tunnel Drift by proxying requests server-side.
 * - Handles method-agnostic forwarding (GET/POST).
 */
export async function GET(request: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  return handleRequest(request, params.path);
}

export async function POST(request: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  return handleRequest(request, params.path);
}

async function handleRequest(request: NextRequest, pathParts: string[]) {
  let tunnelBase: string;
  try {
    tunnelBase = resolveTargetBase(request);
  } catch (error: any) {
    return NextResponse.json({ error: 'Invalid Nexus target', message: error.message }, { status: 400 });
  }

  const endpoint = pathParts.join('/');
  const url = `${tunnelBase}/${endpoint.replace(/^\/+/, '')}`;

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  headers.set('bypass-tunnel-reminder', 'true');

  const nexusKey = request.headers.get('x-nexus-key') || getServerNexusKey();
  if (nexusKey) {
    headers.set('x-nexus-key', nexusKey);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  const options: RequestInit = {
    method: request.method,
    headers,
    cache: 'no-store',
    redirect: 'manual',
    signal: controller.signal,
  };

  if (request.method === 'POST') {
    try {
      const bodyText = await request.text();
      if (bodyText) {
        if (new TextEncoder().encode(bodyText).length > PROXY_BODY_LIMIT) {
          return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
        }
        options.body = bodyText;
      }
    } catch (e) {
      console.warn("Proxy: Failed to parse request body");
    }
  }

  try {
    const response = await fetch(url, options);
    const data = await response.text();
    clearTimeout(timeout);
    
    return new NextResponse(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    clearTimeout(timeout);
    console.error(`Proxy Bridge Fault to ${url}:`, error.message);
    return NextResponse.json({ 
      error: 'Nexus Node Unreachable', 
      message: error.message,
      target: url 
    }, { status: 502 });
  }
}

function getServerNexusKey(): string {
  const envKey = process.env.NEXUS_KEY || process.env.NEXUS_SECURITY_KEY;
  if (envKey) return envKey.trim();

  try {
    if (fs.existsSync(LOCAL_KEY_PATH)) {
      return fs.readFileSync(LOCAL_KEY_PATH, 'utf8').trim();
    }
  } catch (error: any) {
    console.warn('Proxy: Failed to read local Nexus key:', error.message);
  }

  return '';
}

function resolveTargetBase(request: NextRequest): string {
  const allowClientTarget = process.env.NEXUS_ALLOW_CLIENT_TARGET === '1';
  const targetHeader = allowClientTarget ? request.headers.get('x-nexus-target') : null;
  const configuredTarget = process.env.NEXUS_BASE_URL || process.env.NEXT_PUBLIC_NEXUS_BASE_URL || DEFAULT_NEXUS_TARGET;
  const rawTarget = targetHeader || configuredTarget;
  const parsed = new URL(rawTarget);

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Nexus target must use http or https.');
  }

  if (targetHeader && isPrivateHost(parsed.hostname) && process.env.NEXUS_ALLOW_PRIVATE_CLIENT_TARGETS !== '1') {
    throw new Error('Client-selected private network targets are disabled.');
  }

  return parsed.toString().replace(/\/+$/, '');
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/^(127|10)\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return true;
  return false;
}
