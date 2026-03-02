@echo off
pushd "%~dp0"
:menu
cls
echo ==========================================
echo       NEXUS NODE: MONOREPO HUB (V14.0)
echo ==========================================
echo  [1] START UPLINK (Auto-Ignition)
echo  [2] TERMINATE ALL (Hard Reset)
echo  [3] EXIT
echo ==========================================
set /p choice="Select Protocol [1-3]: "

if "%choice%"=="1" (
    echo [ON] Launching Nexus Node...
    :: Path is now relative to the Hub
    start "COUNCIL_NEXUS_NODE" /D "C:\Windows" wsl -d Ubuntu -e bash -c "cd /home/alvin-linux/OpenClawStuff/.openclaw/workspace/command-center/Council-Hud/Council-Data-Router && node router.js"
    timeout /t 2 > nul
    echo [ON] Establishing Cloudflare Tunnel...
    start "NEXUS_TUNNEL" /D "C:\Windows" wsl -d Ubuntu -e bash -c "cd /home/alvin-linux/OpenClawStuff/.openclaw/workspace/command-center/Council-Hud/Council-Data-Router && node utils/tunnel_manager.js"
    echo.
    echo UPLINK SEQUENCE INITIATED.
    timeout /t 3 > nul
    goto menu
)
if "%choice%"=="2" (
    echo [OFF] Terminating all Node processes...
    taskkill /F /IM node.exe /T > nul 2>&1
    wsl -d Ubuntu -e bash -c "fuser -k 3001/tcp 2>/dev/null; pkill -f node"
    echo [STATUS] System Offline.
    pause
    goto menu
)
if "%choice%"=="3" (
    popd
    exit
)
goto menu
