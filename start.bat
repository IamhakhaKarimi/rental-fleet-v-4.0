@echo off
REM Boots the launcher, which serves index.html and starts the servers when you
REM pick a mode there. No more stray server windows to keep track of.
title Balkan Fleet v4.0 - Launcher
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Python was not found on PATH.
  echo   Install Python 3.11+ from python.org, then run this again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js / npm was not found on PATH.
  echo   Install Node.js from nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "frontend\node_modules" (
  echo.
  echo   First run - installing frontend dependencies. This takes a few minutes.
  echo.
  pushd frontend
  call npm install
  popd
)

python "launcher\launcher.py"
if errorlevel 1 pause
