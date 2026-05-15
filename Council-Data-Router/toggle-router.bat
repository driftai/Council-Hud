@echo off
setlocal EnableExtensions

set "ROUTER_DIR=%~dp0"
for %%I in ("%ROUTER_DIR%..") do set "ROOT_DIR=%%~fI"
set "AUTO_CHOICE=%~1"

REM ------------------------------------------------------------------
REM IPC stack identity comes from council.local.bat (gitignored) so the
REM tracked launcher carries no real agent names or WSL paths. Copy
REM council.local.example.bat next to this file and fill it in to enable
REM options [7] / [8] / [9]. Without a local file, those options are
REM disabled but the HUD + router still work fine.
REM ------------------------------------------------------------------
set "WSL_DISTRO=Ubuntu"
set "WSL_USER=linux-user"
set "IPC_HUB_PATH=/home/linux-user/.npm-global/lib/node_modules/xihe-jianmu-ipc/hub.mjs"
set "OC_SCRIPTS=/home/linux-user/.openclaw/workspace/scripts"
set "IPC_LAUNCHERS_AVAILABLE=0"
if exist "%ROUTER_DIR%council.local.bat" (
    call "%ROUTER_DIR%council.local.bat"
)

:menu
cls
echo ==========================================
echo       COUNCIL HUD: LOCAL NEXUS STACK
echo ==========================================
echo  [1] START HUD + ROUTER
echo  [2] START ROUTER ONLY
echo  [3] START CLOUDFLARE TUNNEL
echo  [4] SETUP CORE TEMP AUTOSTART
echo  [5] TERMINATE LOCAL STACK
echo  [6] SET NVIDIA API KEY
echo  ------------------------------------------
echo  [7] START IPC STACK (hub + bridges)
echo  [8] STOP IPC STACK
echo  [9] IPC STATUS
echo  ------------------------------------------
echo  [10] EXIT
echo ==========================================
if defined AUTO_CHOICE (
    set "choice=%AUTO_CHOICE%"
    set "AUTO_CHOICE="
) else (
    set /p choice="Select Protocol [1-10]: "
)

if "%choice%"=="1" (
    call :ensure_node
    if errorlevel 1 goto menu
    call :ensure_dependencies "%ROOT_DIR%" "HUD"
    if errorlevel 1 goto menu
    call :ensure_dependencies "%ROUTER_DIR%" "Nexus Router"
    if errorlevel 1 goto menu
    call :start_router
    call :start_hud
    echo.
    echo LOCAL STACK STARTED.
    echo HUD:    http://localhost:9002
    echo Router: http://127.0.0.1:3001
    pause
    goto menu
)

if "%choice%"=="2" (
    call :ensure_node
    if errorlevel 1 goto menu
    call :ensure_dependencies "%ROUTER_DIR%" "Nexus Router"
    if errorlevel 1 goto menu
    call :start_router
    echo.
    echo ROUTER STARTED: http://127.0.0.1:3001
    pause
    goto menu
)

if "%choice%"=="3" (
    call :ensure_node
    if errorlevel 1 goto menu
    where cloudflared >nul 2>&1
    if errorlevel 1 (
        echo.
        echo cloudflared was not found on PATH.
        echo Install Cloudflare Tunnel first, or use the local HUD route: /api/nexus
        pause
        goto menu
    )
    start "NEXUS_TUNNEL" cmd /k "cd /d ""%ROUTER_DIR%"" && node utils\tunnel_manager.js"
    echo.
    echo TUNNEL START REQUESTED.
    pause
    goto menu
)

if "%choice%"=="4" (
    call "%ROUTER_DIR%setup-core-temp-autostart.bat"
    goto menu
)

if "%choice%"=="5" (
    echo [OFF] Terminating local HUD/router ports...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 3001,9002 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
    echo [STATUS] Local stack stopped.
    pause
    goto menu
)

if "%choice%"=="6" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROUTER_DIR%utils\set-nvidia-env-key.ps1" -ProjectRoot "%ROOT_DIR%"
    pause
    goto menu
)

if "%choice%"=="7" (
    call :ensure_wsl
    if errorlevel 1 goto menu
    call :start_ipc_stack
    goto menu
)

if "%choice%"=="8" (
    call :ensure_wsl
    if errorlevel 1 goto menu
    call :stop_ipc_stack
    goto menu
)

if "%choice%"=="9" (
    call :ensure_wsl
    if errorlevel 1 goto menu
    call :ipc_status
    pause
    goto menu
)

if "%choice%"=="10" (
    exit /b 0
)

goto menu

:ensure_node
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo Node.js was not found on PATH.
    echo Install Node.js LTS, then run this launcher again.
    pause
    exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
    echo.
    echo npm was not found on PATH.
    echo Install Node.js LTS, then run this launcher again.
    pause
    exit /b 1
)
exit /b 0

:ensure_wsl
where wsl.exe >nul 2>&1
if errorlevel 1 (
    echo.
    echo wsl.exe was not found on PATH.
    echo The IPC stack lives inside WSL ^(%WSL_DISTRO%^). Install WSL first.
    pause
    exit /b 1
)
exit /b 0

:ensure_dependencies
set "TARGET_DIR=%~1"
set "LABEL=%~2"
if not exist "%TARGET_DIR%\node_modules" (
    echo.
    echo Installing %LABEL% dependencies...
    pushd "%TARGET_DIR%"
    call npm install
    set "NPM_EXIT=%ERRORLEVEL%"
    popd
    if not "%NPM_EXIT%"=="0" (
        echo Failed to install %LABEL% dependencies.
        pause
        exit /b 1
    )
)
exit /b 0

:start_router
start "COUNCIL_NEXUS_NODE" cmd /k "cd /d ""%ROUTER_DIR%"" && node router.js"
exit /b 0

:start_hud
start "COUNCIL_HUD" cmd /k "cd /d ""%ROOT_DIR%"" && npm run dev"
exit /b 0

:start_ipc_stack
if "%IPC_LAUNCHERS_AVAILABLE%"=="0" (
    echo.
    echo [IPC] No local bridge launchers configured.
    echo       Copy council.local.example.bat to council.local.bat and fill in
    echo       your real agent names + WSL paths, then re-run this option.
    echo       The HUD's POST /api/council/ipc/start endpoint can also drive
    echo       the stack from council.config.local.json — same data, different
    echo       entry point.
    pause
    exit /b 0
)
echo.
echo [IPC] Toggling MCP configs ON via ipc-toggle.sh...
wsl.exe -d %WSL_DISTRO% -u %WSL_USER% -- bash -lc "bash %OC_SCRIPTS%/ipc-toggle.sh on"
echo.
echo [IPC] Launching hub in its own window...
start "COUNCIL_IPC_HUB" wsl.exe -d %WSL_DISTRO% -u %WSL_USER% --cd "%IPC_HUB_DIR%" -- node %IPC_HUB_PATH%
timeout /t 4 /nobreak >nul
echo.
echo [IPC] Launching agent bridges from council.local.bat...
call "%ROUTER_DIR%council.local.bat" bridges
timeout /t 4 /nobreak >nul
echo.
echo [IPC] Stack started. Hub at http://127.0.0.1:3179 ^(inside WSL^).
echo [IPC] HUD will show linked sessions at http://localhost:9002.
pause
exit /b 0

:stop_ipc_stack
echo.
echo [IPC] Killing bridges + hub via ipc-toggle.sh off...
wsl.exe -d %WSL_DISTRO% -u %WSL_USER% -- bash -lc "bash %OC_SCRIPTS%/ipc-toggle.sh off"
echo.
echo [IPC] Sweeping any remaining bridge daemons...
wsl.exe -d %WSL_DISTRO% -u %WSL_USER% -- bash -lc "pkill -f 'bridge.py' 2>/dev/null; pkill -f 'hub.mjs' 2>/dev/null; echo done"
echo [STATUS] IPC stack stopped.
pause
exit /b 0

:ipc_status
echo.
echo [IPC] Status snapshot:
wsl.exe -d %WSL_DISTRO% -u %WSL_USER% -- bash -lc "bash %OC_SCRIPTS%/ipc-toggle.sh status; echo ''; echo '--- bridge processes ---'; pgrep -fa 'bridge.py' 2>/dev/null || echo '(none)'; echo ''; echo '--- HUD reachable? ---'; curl -s -o /dev/null -w 'HUD %%{http_code}\n' --max-time 3 http://localhost:9002/api/council/status 2>/dev/null || echo 'HUD offline'"
exit /b 0
