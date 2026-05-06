@echo off
setlocal
set "SCRIPT=%~dp0utils\setup-libre-hardware-monitor-autostart.ps1"

if not exist "%SCRIPT%" (
  echo Missing setup script:
  echo %SCRIPT%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
echo.
echo If Windows showed an administrator prompt, approve it once to complete setup.
pause
