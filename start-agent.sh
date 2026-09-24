#!/bin/bash
set -e

echo "========================================================"
echo "  🚀 Local AI Agent Server"
echo "  MatterLog AI Wall-bounce Assistant"
echo "========================================================"
echo ""

if ! command -v node &> /dev/null; then
  echo "[ERROR] Node.js is not installed or not in PATH."
  exit 1
fi

if ! command -v claude &> /dev/null; then
  echo "[INFO] Claude CLI not found in PATH. Server will search ~/.local/bin or /opt/homebrew/bin."
fi

echo "Starting agent server on port 3456..."
node agent/server.mjs
