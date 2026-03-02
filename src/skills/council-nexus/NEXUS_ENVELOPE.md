# Skill: The Nexus Envelope Protocol
*Domain: Data Multiplexing & Cloud Integration*

## 1. The Schema
All data crossing the bridge must be wrapped in a standardized "Envelope" so the HUD can route it dynamically.

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
    "data": "..."
  }
}
```

## 2. Universal Ingress
External scripts (Python/Go/Bash) can "push" data to the HUD by POSTing JSON to `localhost:3001/nexus/push`. The router handles the envelope wrapping automatically.

## 3. Bi-Directional Commands
The HUD can send directives to the local node via `POST /nexus/command`.
- `SET_PATH`: Re-targets the Shadow Mirror.
- `KILL_PROCESS`: Triggers the Reaper Protocol for a specific PID.
