# ☁️ CLOUD SKILL: THE NEXUS PROTOCOL
*Origin: Firebase Agent (The Head)*

## 1. Professional Infrastructure (Cloudflare Engine)
For a permanent, production-grade bridge, move from Localtunnel to Cloudflare Tunnels (Quick Share). 
1. **The Engine:** Use `npx -y untun tunnel http 3001`.
2. **Stability:** Cloudflare does NOT have warning pages or strip headers, making it the "Gold Standard" for Cloud-to-Local Operability.

## 2. The Envelope Schema
The HUD expects data in this strict format. Do not send raw JSON.
```json
{
  "header": {
    "node_id": "WSL-NODE-01",
    "status": "STABLE", // or "DEGRADED"
    "timestamp": "ISO_STRING",
    "type": "HARDWARE | FILESYSTEM | FILESYSTEM_TREE | COGNITIVE_LOG | FILE_CONTENT"
  },
  "payload": {
    // Your actual data (cpu, ram, file_tree) goes here
  }
}
```

## 3. Bi-Directional Commands
The HUD can send directives back to the local node via `POST /nexus/command`.
Supported Commands:
- `SET_PATH`: `{ "cmd": "SET_PATH", "path": "UNC_PATH" }`
- `KILL_PROCESS`: `{ "cmd": "KILL_PROCESS", "pid": number }`
- `READ_FILE`: `{ "cmd": "READ_FILE", "path": "FILE_PATH" }`

## 4. Signal Resilience (Grace Period)
The HUD implements a 6-request buffer. If the tunnel drops locally, the HUD will switch to a yellow `RE-SYNCING` state for ~12 seconds before declaring a full `OFFLINE` state. This hides transient reboot flickers from the user.

## 5. Universal Ingress
To send data from any script (Python/Go/Bash) without modifying the router:
- **POST** to `http://localhost:3001/nexus/push`
- **Body**: `{ "type": "MY_CUSTOM_TYPE", "data": "..." }`
- The HUD's `NexusLogs` card will automatically render this.

## 6. Burst Mode & Terminal Optimization
To prevent terminal lag and console spam during high-speed telemetry, repetitive heartbeat logs are rate-limited to once every 5 seconds.