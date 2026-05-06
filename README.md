# 🏛️ Council HUD | AI Command Center
**Phase 200: Platinum Monorepo Operational**

The Council HUD is a high-performance, private cloud operating system designed for autonomous AI agents. It establishes a secure **Direct Neural Link** between remote cloud workstations and local physical hardware, enabling real-time surveillance, file manipulation, and process orchestration.

---

## 🏗️ System Architecture

The project is structured as a **Platinum Monorepo**, ensuring total synchronization between the intelligence layer and the execution layer.

-   **`/` (The Root)**: Next.js / Firebase Studio Environment (The Brain).
-   **`/Council-Data-Router`**: WSL-hosted Node.js Uplink (The Hands).
-   **`/docs`**: Reconstructive blueprints and architectural history.

---

## 🚀 Deployment Sequence

### Local Windows Quick Start
1.  Install Node.js LTS.
2.  Run `Council-Data-Router/toggle-router.bat`.
3.  Select **[1] START HUD + ROUTER**.
4.  Open `http://localhost:9002`.

The launcher installs missing npm dependencies, starts the local router at `http://127.0.0.1:3001`, and starts the HUD at `http://localhost:9002`. The HUD defaults to `/api/nexus`, so local telemetry works without copying a tunnel URL or security key.

### Optional Remote Tunnel
1.  Install `cloudflared`.
2.  Run `Council-Data-Router/toggle-router.bat`.
3.  Select **[3] START CLOUDFLARE TUNNEL**.
4.  Use the printed tunnel URL only when you need a remote browser to reach the local router.

---

## 🛡️ Operational Protocols

The system operates under strict **Platinum-grade** security and stability protocols:

-   **Nexus Shield**: Mandatory `x-nexus-key` authentication for all command ingress.
-   **Iron Siphon**: Aggressive JSON sanitization to defeat hidden Byte Order Marks (BOMs).
-   **Direct Neural Link**: Bypasses internal cloud proxies to eliminate 530/404 errors.
-   **Backslash Exorcist**: Real-time Windows-to-WSL path normalization.
-   **Sticky Session (V13.1)**: In-memory path persistence to prevent UI flickering.
-   **Peek Protocol**: Depth-limited recursive directory scanning (Max Depth: 3) for massive media folders.

---

## 🌉 Synchronization (Nix Protocol)

This project is optimized for **Project IDX** environments. To synchronize the grid:

1.  **Pull Updates**: `git pull origin main` (Synchronizes Brain and Hands).
2.  **Commit Changes**:
    ```bash
    git add .
    git commit -m "feat: protocol optimization"
    git push origin main
    ```

---

## 📊 System Diagnostics
-   **Heartbeat**: `GET /health` (Always Open)
-   **Telemetry**: `GET /graph` (Auth Protected)
-   **Filesystem**: `POST /filesystem/tree` (Auth Protected)
-   **Executive**: `/exec`, `/read-file`, `/write-file` (Auth Protected)

### CORE_TEMP Telemetry

`CORE_TEMP` uses real sensor data only. On Windows systems that do not expose CPU temperature natively, run `Council-Data-Router/setup-core-temp-autostart.bat` once and approve the administrator prompt. This installs/starts LibreHardwareMonitor as a highest-privilege logon task and enables its local sensor feed at `http://127.0.0.1:8085/data.json`, so later HUD sessions can read CPU temperature without repeated UAC prompts.

---

## 🎖️ Acknowledgements & Legacy

This project, and the broader "agentic vibe" that drives it, was born from the foundational influence of **OpenClaw**. 

OpenClaw provided the initial spark for autonomous AI experimentation and remains the spiritual predecessor to the Council HUD architecture. We honor the heritage of the OpenClaw ecosystem as we push the boundaries of neural-to-hardware interoperability.

Additional agents that worked on this project: Nova, Astro.

---
**[SIGNAL_STATUS]**: GOLDEN_STATE  
**[ENCRYPTION]**: AES-256-NEXUS  
**[OPERATOR_ID]**: REDACTED
