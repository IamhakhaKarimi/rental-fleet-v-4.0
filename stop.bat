@echo off
echo Stopping Balkan Fleet servers (ports 3000 and 8001)...
for %%P in (3000 8001) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
)
echo Done.
timeout /t 2 /nobreak >nul
