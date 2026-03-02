# Protocol: Operation Nexus // Phase 10: Immortal Cloudflare Bridge

## Overview
The "Golden State" architecture uses a **Cloudflare Tunnel (untun)** engine to bridge local hardware to the cloud. This replaces fragile session-based tunnels with a professional, enterprise-grade link.

## System Components
- **The Body (Local Node)**: Modular Node.js server with Cloudflare Quick Share management.
- **The Head (Cloud HUD)**: Next.js dashboard with a dynamic data registry and remote control.
- **The Iron Link**: A self-healing manager that pings the tunnel every 60s and auto-restarts on drops.

## Signal Resilience
- **Grace Period**: The HUD implements a 12-second (6-request) buffer to hide tunnel restarts.
- **Burst Mode**: The local router groups telemetry logs to reduce console lag and overhead.
- **Steady Signal LED**: Real-time visual feedback of background polling health.

## Execution Standards
1. **Zero-Armor**: Cloudflare does not require bypass headers or handshake portals.
2. **CORS Master Key**: Local server must explicitly allow all origins and handle OPTIONS pre-flight.
3. **UNC Pathing**: Bridge Windows to WSL using `\\wsl.localhost\Ubuntu\...` paths for file watching.
