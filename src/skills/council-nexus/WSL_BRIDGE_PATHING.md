# Skill: WSL & Cross-Platform Bridge Pathing
*Domain: Filesystem Interoperability (Windows/Linux)*

## 1. The UNC Pathing Secret
When running a Node.js process on Windows that needs to index or watch files inside a Linux WSL distribution, standard Linux paths (`/home/user/...`) are invisible.
- **The Fix**: Use Windows UNC paths: `\\wsl.localhost\Ubuntu\home\alvin-linux\OpenClawStuff`.
- **Note**: In JSON or Batch strings, remember to quadruple-escape backslashes: `\\\\wsl.localhost\\...`.

## 2. EISDIR & Shortcut Stability
Windows system shortcuts (`.lnk` files) inside WSL folders frequently crash the `chokidar` library with an `EISDIR: illegal operation` error.
- **The Fix**: Strictly ignore `/\.lnk$/` and `/\.tmp$/` in all file watchers.
- **The Fix**: Enable `usePolling: true` in the watcher configuration. While slower, it is the only reliable way to detect changes across the Windows-to-Linux VM boundary.

## 3. Directory Rooting
When launching `.bat` files targeting WSL, use `pushd "%~dp0"` to map the UNC path to a temporary drive letter. CMD.exe cannot natively navigate UNC paths and will default to `C:\Windows` otherwise.
