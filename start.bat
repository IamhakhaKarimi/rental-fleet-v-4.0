@echo off
title Balkan Fleet v4.0 - Launcher
cd /d "%~dp0"

echo ============================================
echo   Balkan Car Rentals - Fleet Console v4.0
echo ============================================
echo.
echo Starting API (FastAPI) on http://localhost:8001 ...
start "Balkan Fleet API" cmd /k "cd /d "%~dp0backend" && python -m uvicorn api.main:app --port 8001"

echo Starting Web app (Next.js) on http://localhost:3000 ...
start "Balkan Fleet Web" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo Waiting for the servers to boot...
timeout /t 9 /nobreak >nul

echo Opening the launcher page...
start "" "%~dp0index.html"

echo.
echo Two server windows opened. Login: admin / admin
echo Close those windows (or run stop.bat) to stop the app.
echo.
pause
