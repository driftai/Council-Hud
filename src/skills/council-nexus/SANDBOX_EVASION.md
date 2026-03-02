# Skill: Cloud Sandbox Evasion (Legacy Mastery)
*Domain: Iframe Security & Cross-Domain Handshaking*

## 1. The Sandbox Wall
Cloud IDE Iframes (Google Workstations, IDX) strip custom headers and block session cookies from third-party tunnels like Localtunnel.

## 2. The Silver Bullet (URL Injection)
If headers are stripped, move the authorization key to the URL parameters.
- **Implementation**: Append `?bypass=true` to all fetch requests.
- **Router Logic**: Use middleware to detect the query parameter before parsing endpoint paths.

## 3. The Portal Handshake
When cookies are required, use `window.open` to "invite" the tunnel's security cookie into the browser session, which unblocks the sandboxed Iframe automatically.

## 4. EISDIR Fix (WSL Integration)
When watching WSL files from a Windows Node process:
- **Rule**: You MUST use Windows UNC paths.
- **Rule**: You MUST ignore `.lnk` (Shortcut) files or chokidar will crash with an `EISDIR` illegal operation error.
