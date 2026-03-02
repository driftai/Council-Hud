# Master Protocol: The Council Nexus (Consolidated Intelligence)
*Phase 10: Golden State Operational // Operation Split-Brain*

This document contains the consolidated technical intelligence for building an immortal, self-healing, bi-directional bridge between a restricted Cloud Sandbox and a local workstation.

---

## 1. Infrastructure: The Iron Link (Cloudflare Engine)
**Domain:** Networking, Stability, Enterprise Bridging

### The Technical Protocol
Move away from fragile, session-based tunnels (like Localtunnel) toward professional infrastructure. Use Cloudflare Quick Share (`untun`) for 100% uptime and zero-configuration CORS handling.

### Implementation Logic
- **The Engine:** Use `npx -y untun tunnel http 3001`.
- **Zero-Armor:** Cloudflare does not require "Bypass Headers" or manual cookie portals, making it the "Gold Standard" for Cloud-to-Local operability.
- **Stability:** Cloudflare handles pre-flight OPTIONS requests natively, eliminating the "CORS Wall" common in restricted Iframe environments.

---

## 2. Data Multiplexing: The Nexus Envelope
**Domain:** Protocol Design, Data Integrity

### The Packet Schema
All data crossing the bridge must be wrapped in a standardized "Envelope." This allows the Cloud HUD to route telemetry, files, and logs dynamically without separate endpoints for every data type.

```json
{
  "header": {
    "node_id": "WSL-NODE-01",
    "timestamp": "ISO_STRING",
    "type": "HARDWARE | FILESYSTEM | FILESYSTEM_TREE | COGNITIVE_LOG | FILE_CONTENT",
    "status": "STABLE | DEGRADED",
    "priority": "REALTIME | BATCH"
  },
  "payload": {
    "data": "{...}"
  }
}
```

---

## 3. Sandbox Evasion & Handshake Logic
**Domain:** Browser Security, Iframe Restrictions

### The Challenge
Cloud IDE Iframes (Firebase Studio, IDX) strip custom headers and block third-party cookies.

### Technical Solutions
1. **URL Injection:** If headers are stripped, pass the authorization key in the query string (`?bypass=true`).
2. **The Portal Handshake:** If cookies are required, use `window.open` to "invite" the security cookie into the browser session via a popup.
3. **CORS Master Key:** Local servers must explicitly allow all origins (`*`) and provide manual fallback headers:
```javascript
res.header("Access-Control-Allow-Origin", "*");
res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
```

---

## 4. Cross-Platform Pathing: The WSL Bridge
**Domain:** Filesystem Interoperability (Windows/Linux)

### The UNC Implementation
When running a Node.js process on Windows meant to index or watch files inside a Linux WSL distribution, standard Linux paths (`/home/user/...`) are invisible to the Windows OS.

### Technical Rules
1. **UNC Pathing:** Use Windows UNC paths: `\\wsl.localhost\Ubuntu\home\user\folder`.
2. **EISDIR Protection:** Windows shortcuts (`.lnk`) inside WSL folders often crash the `chokidar` library. You MUST strictly ignore `/\.lnk$/`.
3. **Polling Mode:** Enable `usePolling: true` in file watchers. It is the only reliable way to detect changes across the Windows-to-Linux VM boundary.

---

## 5. Signal Resilience & UI Smoothing
**Domain:** Reliability Engineering, UX Design

### The Grace Period Logic
Network packets in cloud-bridged systems will drop. To prevent UI flickering, implement a failure threshold instead of a boolean check.

```javascript
// Implementation Pattern
if (fetchFailed) {
  consecutiveFailures++;
  if (consecutiveFailures < 6) {
    status = "RE-SYNCING"; // Yellow State (Keep UI visible)
  } else {
    status = "OFFLINE"; // Red State
  }
}
```

---

## 6. Bi-Directional Command & Control (C2)
**Domain:** Remote Execution, System Orchestration

### Ingress Architecture
Create a dedicated `POST /nexus/command` endpoint on the local router.
- **Payload:** `{ "cmd": "STRING_ID", "payload": { ... } }`
- **Hot-Reloading:** When a command changes a setting (like the Target Path), the local node must update its `config.json` and manually trigger `stop()` and `start()` on its collectors in-memory without rebooting the process.

---

## 7. Executive Operations: Reaper & Peek
**Domain:** Remote OS Control

### The Reaper Protocol (Process Control)
Allows the Cloud HUD to terminate local processes.
- **Implementation:** `process.kill(pid, 'SIGTERM')` via the Command Ingress.

### The Peek Protocol (File Inspection)
Allows the Cloud HUD to read local code or text files safely.
- **Bandwidth Shielding:** Capped at 50KB per file to prevent tunnel lockup.
- **Binary Filtering:** Rejects directories, `.exe`, and `.dll` files.
- **Code:** `fs.readFileSync(target, 'utf8')`

---
*End of Consolidated Nexus Intelligence*