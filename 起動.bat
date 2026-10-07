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
if errorlevel 1 (
  echo.
  echo Could not start the server. If port 5173 is already in use, Madori Simulator may already be running.
  echo Open http://localhost:5173 in your browser instead.
  echo Your saved plans live in that address only, so do not use another port.
)

pause
