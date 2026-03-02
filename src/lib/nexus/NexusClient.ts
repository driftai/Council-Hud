/**
 * @fileOverview NexusClient V150 - Platinum State Edition
 * - Implements The Nexus Shield (x-nexus-key authentication)
 * - Directly communicates with Cloudflare Tunnels (Bypasses Proxy)
 * - Uses POST for File Tree to support large path payloads
 */

export interface NexusHeader {
  node_id: string;
  packet_id: string;
  timestamp: string;
  priority: "REALTIME" | "BATCH" | "LOW" | "BACKGROUND";
  schema_version: string;
  status: "STABLE" | "DEGRADED" | "SYNCING";
  type?: "HARDWARE" | "GRAPH" | "FILESYSTEM" | "FILESYSTEM_TREE" | "COGNITIVE_LOG" | "FILE_CONTENT";
}

export interface NexusEnvelope<T> {
  header: NexusHeader;
  payload: T;
}

export class NexusClient {
  private targetUrl: string;

  constructor(url: string) {
    this.targetUrl = url || "";
  }

  private getUrl(endpoint: string): string {
    const base = this.targetUrl.replace(/\/+$/, '');
    const path = endpoint.replace(/^\/+/, '');
    if (!base) return `/${path}`;
    return `${base}/${path}`;
  }

  /**
   * Retrieves the security key from local storage
   */
  private getSecurityKey(): string {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('nexus_security_key') || '';
    }
    return '';
  }

  /**
   * Universal Fetch (GET/POST)
   * Protected by the Nexus Shield (x-nexus-key)
   */
  async fetchEnvelope<T>(endpoint: string, options: { method?: string; body?: any } = {}): Promise<NexusEnvelope<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), endpoint.includes('tree') ? 10000 : 5000);
    const url = this.getUrl(endpoint);
    const key = this.getSecurityKey();

    const fetchOptions: RequestInit = {
      method: options.method || 'GET',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'bypass-tunnel-reminder': 'true',
        'x-nexus-key': key
      },
      signal: controller.signal
    };

    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, fetchOptions);

      if (response.status === 401) {
        throw new Error("Security Alert: Invalid Nexus Key.");
      }

      if (!response.ok) {
        throw new Error(`Nexus Node Error: ${response.status}`);
      }

      const data = await response.json();
      clearTimeout(timeoutId);
      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Legacy Command Wrapper (Now uses unified fetch)
   */
  async sendCommand(endpoint: string, payload: any): Promise<any> {
    return this.fetchEnvelope(endpoint, {
      method: 'POST',
      body: payload
    });
  }
}
