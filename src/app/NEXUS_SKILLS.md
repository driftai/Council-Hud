# Master Protocol: The Council Nexus (Consolidated Intelligence)
*Phase 12: Agentic Orchestration // Operation Immortal Bridge*

## 1. Agentic Directives (Genkit Command Bridge)
The HUD includes a **Neural Command Center**. This allows the Cloud HUD's AI brain to analyze system telemetry and translate natural language requests into specific hardware directives.

### Atomic Handshake Protocol:
- **Challenge:** React state delay causes the AI to "forget" it just read a file.
- **Solution:** Use a synchronous `localHistory` accumulator inside the turn-processing loop. Inject retrieved file content immediately and trigger the next AI turn in the same execution thread.

---

## 2. Infrastructure: The Proxy Fortress
**Domain:** Networking, Sandbox Evasion, CORS Resolution

### The Fortress Implementation:
- **The Problem:** Browser-to-Tunnel requests are blocked by Google's auth-proxy (302 Redirects).
- **The Fix:** Route all requests through a server-side Next.js API (`/api/nexus`).
- **Auth:** Force `credentials: 'include'` to allow the workstation session to pass through to the internal tunnel.

---

## 3. Data Integrity: The Backslash Exorcist
**Domain:** JSON Parsing, Cross-Platform Pathing

### The Exorcism Logic:
- **The Problem:** AI models emit raw Windows paths (`C:\Users\...`) which crash `JSON.parse`.
- **The Fix:** Implement a pre-parser that scans for JSON blocks and flips all `\` to `/` before the parser hits them.

---

## 4. Signal Resilience (Phase 120)
**Domain:** Reliability Engineering, UX Stability

### Anti-Flicker Logic:
- **Failure Threshold:** 10 consecutive requests (20 seconds).
- **Polling Lock:** Use a React `ref` to prevent stacking overlapping telemetry calls.
- **Grace Period:** Maintain current UI state during `RE-SYNCING` to hide transient tunnel reboots.

---

## 5. Executive Operations: Reaper, Peek & Scribe
- **The Reaper Protocol:** Remote process termination via `process.kill(pid, 'SIGTERM')`.
- **The Peek Protocol (Hardened):** Remote file inspection via the specialized `/read-local` endpoint, bypassing legacy pathing bugs.
- **The Scribe Protocol:** Remote file modification via `POST /write-file`.

---
*End of Consolidated Nexus Intelligence*