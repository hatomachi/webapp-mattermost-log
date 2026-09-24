@echo off
chcp 65001 > nul
title Local AI Agent (MatterLog / Claude Code)
echo ========================================================
echo   🚀 Local AI Agent Server (Windows)
echo   MatterLog AI Wall-bounce Assistant
echo ========================================================
echo.

:: 1. Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo [ERROR] Node.js がインストールされていないか、PATH に通っていません。
  echo 公式サイト (https://nodejs.org/) から Node.js (v18+) をインストールしてください。
  echo.
  pause
  exit /b 1
)

:: 2. Check Claude Code CLI
where claude >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo [INFO] Claude CLI (claude.cmd) が PATH から見つかりません。
  echo        npm install -g @anthropic-ai/claude-code などでインストールされているか、
  echo        または環境変数 CLAUDE_BIN を設定してください。
  echo.
)

:: 3. Start Agent Server
echo エージェントサーバーを起動します (ポート 3456)...
echo 終了するには Ctrl + C を押してください。
echo.

node agent\server.mjs

if %ERRORLEVEL% neq 0 (
  echo.
  echo [ERROR] エージェントサーバーが異常終了しました (終了コード: %ERRORLEVEL%)。
  pause
)
