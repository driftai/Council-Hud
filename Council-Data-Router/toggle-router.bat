@echo off
setlocal EnableExtensions

set "ROUTER_DIR=%~dp0"
for %%I in ("%ROUTER_DIR%..") do set "ROOT_DIR=%%~fI"
set "AUTO_CHOICE=%~1"

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
echo  [6] EXIT
echo ==========================================
if defined AUTO_CHOICE (
    set "choice=%AUTO_CHOICE%"
    set "AUTO_CHOICE="
) else (
    set /p choice="Select Protocol [1-6]: "
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
