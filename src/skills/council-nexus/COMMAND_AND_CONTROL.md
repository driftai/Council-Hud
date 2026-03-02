# Skill: Bi-Directional Command & Control (C2)
*Domain: Remote Execution & System Orchestration*

## 1. The Passive-to-Active Transition
A "Passive" HUD only shows data. An "Active" Nexus allows the Head (Cloud) to drive the Body (Local).

## 2. Command Ingress Architecture
Create a dedicated `POST /nexus/command` endpoint on the local router.
- **Payload Schema**: `{ "cmd": "STRING_ID", "payload": { ... } }`
- **Isolation**: Wrap every command execution in an isolated `try/catch` block so a single failed directive doesn't crash the local data router.

## 3. Hot-Reloading Collectors
When a command changes a system setting (like the `SET_PATH` directive):
1. **Update Persistence**: Write the new value to a local `config.json`.
2. **Re-target Collectors**: Manually trigger `stop()` and `start()` on the relevant collectors (File Watcher, Mirror) in-memory.
3. **Acknowledgment**: Return a `SUCCESS` JSON response only after the collectors have verified the new state.

## 4. The Reaper Protocol
Remote process termination must be handled via `process.kill(pid, 'SIGTERM')`. This allows the Cloud HUD to act as a remote task manager for the local environment.
