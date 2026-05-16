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

## 🔌 Optional Backend Integrations

The HUD works standalone with the local router. The richer cards (Smart Fallback, Skill Nexus, Council Comms) light up when their backend services exist on the same machine. All backend wiring is **opt-in** — no card breaks if its backend isn't there; it just renders an "engine offline" / "domain unreachable" state.

All backend configuration lives in `council.config.local.json` (gitignored). Copy `council.config.example.json` to start — the example uses generic placeholders (`linux-user`, `live-agent-1`, etc.); fill in your real distro name, agent identifiers, and paths there.

### Smart Fallback (Model Routing)

A Python engine that picks the best routable LLM for each agent based on real-time health, rate-limit history, capability evidence, and a multi-criteria score. Lives in WSL (Ubuntu by default).

**Requirements:**
- WSL2 with a Linux distro reachable from Windows (`wsl.localhost` UNC path must work)
- Python 3.10+ inside the distro
- Provider API keys in `~/.hermes/.env` (file mode 600). Supported keys: `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `GITHUB_TOKEN`. The engine and probe runner both auto-load this file at startup so no shell-export plumbing is needed.
- An `engine.py` deployed to a workspace dir (the v5 engine is a single-file script; see the `smartFallback.enginePath` field in `council.config.example.json` for the conventional location).
- A model catalog at `~/.openclaw/openclaw.json` shaped as `{models: {providers: {<name>: {baseUrl, apiKey, models: [{id, name, contextWindow, ...}]}}}}`.

**Once wired:**
- `POST /api/council/fallback/snapshot` returns the live model table
- The Smart Fallback card shows healthy / blocked / decommissioned counts, picks per agent with weighted score breakdown, and provider-by-provider context windows
- "Reprobe blocked" button on the card triggers the probe script for any model whose last error is `missing-env-*`, `timeout`, or `http-4xx`
- Decommissioned models (retired provider endpoints) are kept on record in their own tab with the failure reason

### Skill Nexus (Federated Skill Registry)

A unified read-only view of every "skill source" the operator monitors: Claude/Codex/Gemini skill libraries, evolver lineage, miner outputs, evolution experiments with judge verdicts, runtime hooks, etc. Adapter types currently supported:

| Type | Purpose |
|---|---|
| `skillRoot` | Walk a directory tree of `SKILL.md` + docs |
| `skillEvolver` | Read evolver state + applied_genome.json + original→evolved lineage |
| `skillForge` | Read queue + output dir of a skill-forging pipeline |
| `sessionMiner` | Read mined skill candidates from session-miner outputs |
| `experimentResults` | Parse per-experiment result JSONs with multi-judge subscores |
| `reportFile` | JSON or JSONL feed (with optional `tailKB` for big append-only logs) |
| `syncStatus` | Cross-agent skill sync state |
| `projectDocs` | A project's local skill docs |
| `genericJson` | Fallback for arbitrary structured JSON |

Configure one domain per source in the `skillNexus.domains[]` array of your local config. See `council.config.example.json` for shape and field names per adapter type. Card auto-refreshes every 20 seconds.

### Council Comms Bridge (Optional)

The Council Comms card surfaces agent-to-agent messages via the `xihe-jianmu-ipc` hub. If you have a hub running at `hub.url` and the bridge launchers installed inside WSL (`council.bridges[]`), the card lights up. If not, the card stays dim — no HUD breakage.

### Hermes Router (Optional)

If you run Hermes (or another OpenAI-compatible client) and want it to share the same fallback engine the HUD reads, deploy the router shim at `~/.hermes/model-router/router.py` and run it as a systemd service. The shim listens on `localhost:8877` for `POST /v1/chat/completions`, delegates routing to `engine.py chain --agent <name>`, and reports every outcome back via `engine.py record`. Hermes traffic then shows up alongside everything else in the model-health view, with no duplicate tracker.

### Privacy

- `council.config.local.json` is gitignored — real distro names, usernames, agent labels, paths all live there only
- `.env*` files are gitignored except `.env.example`
- The HUD's `/api/council/*` routes are gated to localhost + same-origin browser requests; remote requests get 403 even via tunnel
- Free-text fields (skill descriptions, miner reasoning, evolver verdicts) pass through `redactAgentNames()` before rendering, replacing real capitalized agent names with their role ("a live agent", "the operator", etc.)

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

The HUD is inspired by the broader open-source agent-framework ecosystem — a heritage of autonomous-AI experiments that fed into the Council HUD architecture and its neural-to-hardware bridge.

---
**[SIGNAL_STATUS]**: GOLDEN_STATE
**[ENCRYPTION]**: AES-256-NEXUS
**[OPERATOR_ID]**: REDACTED
