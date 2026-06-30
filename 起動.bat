@echo off
cd /d "%~dp0"
title Madori Simulator

if not exist "node_modules" (
  echo First-time setup... installing dependencies.
  call npm install
  if errorlevel 1 (
    echo.
    echo Setup failed. Please make sure Node.js is installed.
    pause
    exit /b 1
  )
)

echo Starting Madori Simulator...
echo Your browser will open automatically.
echo To quit, close this window.
call npm run dev

pause
