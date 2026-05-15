@echo off
REM ============================================================
REM Example local council launcher config. Copy this file to
REM "council.local.bat" (gitignored) and fill in the real values
REM for your machine. Tracked code never sees real agent names.
REM
REM Modes:
REM   call "council.local.bat"              => sets WSL vars + IPC_LAUNCHERS_AVAILABLE=1
REM   call "council.local.bat" bridges      => spawns each agent bridge in a hidden window
REM ============================================================

if /I "%~1"=="bridges" goto :bridges

REM ---- Variables ----
REM Linux distro + user that the WSL hub + bridges run under.
set "WSL_DISTRO=Ubuntu"
set "WSL_USER=linux-user"

REM Absolute path inside WSL to the hub.mjs entrypoint.
set "IPC_HUB_PATH=/home/linux-user/.npm-global/lib/node_modules/xihe-jianmu-ipc/hub.mjs"
set "IPC_HUB_DIR=/home/linux-user/.npm-global/lib/node_modules/xihe-jianmu-ipc"

REM Absolute path inside WSL to the openclaw scripts dir (holds ipc-toggle.sh
REM plus the per-agent bridge launchers and bridge-ensure-one.py).
set "OC_SCRIPTS=/home/linux-user/.openclaw/workspace/scripts"

REM Flip to 1 once the above lines are filled in. While 0, the toggle bat hides
REM the IPC options behind a "configure first" message.
set "IPC_LAUNCHERS_AVAILABLE=1"
exit /b 0

:bridges
REM ---- Bridge spawn list ----
REM One Start line per agent. Replace the placeholders with real bridge launchers.
REM Use the council-<agent> wrapper when one exists, otherwise pipe through
REM bridge-ensure-one.py with an absolute script path.
start "COUNCIL_AGENT1_BRIDGE" /MIN wsl.exe -d %WSL_DISTRO% -u %WSL_USER% -- bash -lc "%OC_SCRIPTS%/council-agent-1 council"
start "COUNCIL_AGENT2_BRIDGE" /MIN wsl.exe -d %WSL_DISTRO% -u %WSL_USER% -- bash -lc "python3 %OC_SCRIPTS%/bridge-ensure-one.py %OC_SCRIPTS%/agent-2-bridge.py --topic council --daemon"
exit /b 0
