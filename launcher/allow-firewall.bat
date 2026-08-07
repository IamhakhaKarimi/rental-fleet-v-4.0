@echo off
REM Lets other devices on the same wifi reach the Fleet Console.
REM
REM Scoped to profile=private on purpose: the app stays invisible on public
REM and hotel networks. Needs Administrator - the launcher's button raises the
REM UAC prompt, or right-click this file and "Run as administrator".
title Balkan Fleet - firewall rules

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   This script has to run as Administrator.
  echo   Right-click it and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)

call :ensure "Balkan Fleet Web" 3000
call :ensure "Balkan Fleet API" 8001

echo.
echo   Done. Staff on your wifi can now open the app.
echo.
timeout /t 4 /nobreak >nul
exit /b 0

:ensure
netsh advfirewall firewall show rule name=%1 >nul 2>&1
if not errorlevel 1 (
  echo   [ok] rule %1 already exists
  exit /b 0
)
echo   [+] adding rule %1 for TCP port %2
netsh advfirewall firewall add rule name=%1 dir=in action=allow protocol=TCP localport=%2 profile=private >nul
exit /b 0
