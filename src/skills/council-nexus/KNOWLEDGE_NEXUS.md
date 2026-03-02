# 🧠 KNOWLEDGE NEXUS: Master Intelligence Protocol
*Consolidated Knowhow for Agentic Hardware Control*

This document codifies the architectural breakthroughs and operational standards established during the development of the Council HUD and the Nexus AI Bridge.

---

## 🏗️ 1. Infrastructure: The Proxy Fortress Architecture
**Domain:** Networking, Sandbox Evasion, CORS Resolution

### The "Head & Body" Paradigm
Cloud IDEs (like IDX/Firebase Studio) operate in high-security sandboxes that strip headers and intercept browser requests via auth-proxies.
- **The Body (Local Node):** A WSL-hosted router managing physical hardware telemetry.
- **The Head (Cloud HUD):** A Next.js dashboard providing the visual and cognitive layer.
- **The Fortress:** Never allow the browser to talk directly to the tunnel. All traffic MUST flow through a server-side Next.js Route (`/api/nexus/[...path]`). This eliminates CORS pre-flight failures and hides the shifting Cloudflare subdomains from the frontend logic.

---

## ⚡ 2. AI Orchestration: The Atomic Handshake
**Domain:** Recursive Turn Logic, Cognitive Continuity

### Solving "Operational Amnesia"
Standard React state management is too slow for multi-turn AI interactions (e.g., Command -> Execution -> Result).
- **Synchronous History Accumulation:** Use a local `history` variable inside the processing loop to inject "System Feedback" immediately.
- **Recursive Calling:** If an AI command (like `READ_FILE`) is executed, the resulting data is appended to the history and the AI is re-prompted in the *same execution thread*. This ensures the AI "sees" the file content instantly without waiting for a re-render cycle.

---

## 🛡️ 3. Data Integrity: The Backslash Exorcist
**Domain:** JSON Parsing, Cross-Platform Pathing

### The JSON Escape Crisis
AI models frequently emit raw Windows paths (`C:\Users\...`) inside JSON. In standard JSON, a single backslash is a "Bad Escaped Character," causing `JSON.parse()` to crash instantly.
- **The Exorcism:** Implement a pre-flight parser that recursively finds JSON blocks and replaces all raw backslashes (`\`) with forward slashes (`/`) before parsing.
- **Strict Schema Lock:** Enforce a canonical schema (e.g., `{ thought, command, payload, message }`) using Zod. This provides a "fail-fast" barrier that forces the model to correct its dialect in the next turn rather than crashing the HUD.

---

## 🌉 4. Filesystem Bridging: The WSL Mount Protocol
**Domain:** Path Normalization, Hardware Interoperability

### Windows-to-Linux Translation
When the body (WSL) reads files on the host (Windows), pathing logic often breaks.
- **Automatic Mount Translation:** The Nexus Client must detect `C:/` and automatically flip it to `/mnt/host/c/` or `/mnt/c/` before the packet hits the local node.
- **URI Sanitization:** Always use `decodeURIComponent` to handle spaces in directory names (e.g., "Unidex File") to prevent 404 errors during hardware reads.

---

## 🚀 5. Neural Optimization: The NVIDIA Ministral Bridge
**Domain:** High-Speed Inference, Quota Resilience

### Bypassing Throttling
Standard APIs (like Gemini Free Tier) hit 429 "Resource Exhausted" limits during high-frequency telemetry loops.
- **Ministral-14B Integration:** Use NVIDIA's inference endpoints for high-speed, temperature-zero robotic consistency.
- **System Mandate:** Use a system prompt that explicitly forbids conversational "fluff." Command the model to respond in **PURE JSON ONLY** to keep the bridge clean.

---

## 🚦 6. Signal Resilience: The Grace Period Protocol
**Domain:** UX Stability, Tunnel Auto-Healing

### Anti-Flicker Logic
Network drops in tunneled systems are inevitable. A HUD that switches to "Offline" on a single dropped packet creates a poor user experience.
- **Failure Thresholds:** Implement a 10-request (20-second) grace period.
- **RE-SYNCING State:** Use a yellow interim state that keeps current data on-screen while the tunnel auto-heals, only declaring a hard OFFLINE state after the threshold is exceeded.

---
*End of Protocol // Council HUD // Golden State Operational*
