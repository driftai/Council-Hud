
import { NextRequest, NextResponse } from 'next/server';

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

async function handleRequest(request: NextRequest, path: string[]) {
  const targetHeader = request.headers.get('x-nexus-target');
  const envTarget = process.env.NEXUS_BASE_URL || process.env.NEXT_PUBLIC_NEXUS_BASE_URL;
  const fallback = "https://great-suits-battle.loca.lt";
  
  const tunnelBase = (targetHeader || envTarget || fallback).replace(/\/+$/, '');
  const endpoint = path.join('/');
  const url = `${tunnelBase}/${endpoint.replace(/^\/+/, '')}`;

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');

  const options: RequestInit = {
    method: request.method,
    headers,
    cache: 'no-store'
  };

  if (request.method === 'POST') {
    try {
      const bodyText = await request.text();
      if (bodyText) {
        options.body = bodyText;
      }
    } catch (e) {
      console.warn("Proxy: Failed to parse request body");
    }
  }

  try {
    const response = await fetch(url, options);
    const data = await response.text();
    
    return new NextResponse(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error(`Proxy Bridge Fault to ${url}:`, error.message);
    return NextResponse.json({ 
      error: 'Nexus Node Unreachable', 
      message: error.message,
      target: url 
    }, { status: 502 });
  }
}
