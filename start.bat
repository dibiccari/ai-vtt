@echo off
rem One-step start for Windows: checks Node, installs dependencies, starts AI-VTT.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install it from https://nodejs.org ^(LTS^), then run this file again.
  pause
  exit /b 1
)

for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo Node.js is too old. AI-VTT needs Node 20 or newer: https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting AI-VTT at http://localhost:3000 ^(press Ctrl+C to stop^)
start "" /b cmd /c "timeout /t 3 >nul && start http://localhost:3000"
call npm run dev
pause
