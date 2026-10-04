#!/usr/bin/env bash
# One-step start for macOS/Linux: checks Node, installs dependencies, starts AI-VTT.
# On a Mac you can double-click this file in Finder (first time: right-click > Open).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install it from https://nodejs.org (LTS) or run: brew install node"
  echo "Then close this window and run this file again."
  read -r -p "Press Enter to close..." _
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js $(node -v) is too old. AI-VTT needs Node 20 or newer (https://nodejs.org)."
  read -r -p "Press Enter to close..." _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install || { echo "npm install failed."; read -r -p "Press Enter to close..." _; exit 1; }
fi

echo "Starting AI-VTT at http://localhost:3000 (press Ctrl+C to stop)"
( sleep 3; open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null ) &
npm run dev
read -r -p "The server stopped. Press Enter to close..." _
