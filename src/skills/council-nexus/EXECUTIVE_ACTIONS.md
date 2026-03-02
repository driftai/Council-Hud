# Skill: The Executive Core (Reaper & Peek)
*Domain: Remote Operation & System Control*

## 1. The Reaper Protocol (Process Control)
Allows the Cloud HUD to terminate local processes.
- **Implementation**: `process.kill(pid, 'SIGTERM')` via the Command Ingress.
- **UI**: Triggered by the "Red X" nodes in the Intelligence Graph.

## 2. The Peek Protocol (File Inspection)
Allows the Cloud HUD to read local code/text files.
- **Safety**: Capped at 50KB per file to prevent tunnel lockup.
- **Validation**: Rejects binaries, directories, and heavy extensions.
- **Implementation**: `fs.readFileSync(target, 'utf8')` via `GET /filesystem/read`.

## 3. Recursive Mirroring
Building a navigable tree of a remote Linux filesystem inside a Windows-hosted Node environment using recursive `fs.statSync` and UNC paths.
