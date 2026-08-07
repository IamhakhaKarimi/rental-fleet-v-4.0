@echo off
REM Fallback for when the launcher's Stop button isn't available (window closed,
REM launcher crashed). Port 8800 is the launcher itself.
echo Stopping Balkan Fleet servers (ports 3000, 8001 and 8800)...
for %%P in (3000 8001 8800) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do taskkill /PID %%a /T /F >nul 2>&1
)
echo Done.
timeout /t 2 /nobreak >nul
