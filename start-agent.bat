@echo off
chcp 65001 > nul
title Local AI Agent (MatterLog)
echo ========================================================
echo   🚀 Local AI Agent Server (Windows)
echo   MatterLog AI Wall-bounce Assistant
echo ========================================================
echo.

:: 1. Check Node.js
where node >nul 2>nul
if errorlevel 1 goto :no_node

:: 2. Check Claude Code CLI
where claude >nul 2>nul
if errorlevel 1 goto :no_claude

:start_server
echo エージェントサーバーを起動します (ポート 3456)...
echo 終了するには Ctrl + C を押してください。
echo.

node agent\server.mjs
if errorlevel 1 goto :server_error
exit /b 0

:no_node
echo [ERROR] Node.js がインストールされていないか、PATH に通っていません。
echo 公式サイト https://nodejs.org/ から Node.js (v18以上) をインストールしてください。
echo.
pause
exit /b 1

:no_claude
echo [INFO] Claude CLI が PATH から見つかりません。
echo        npm install -g @anthropic-ai/claude-code でインストールされているか、
echo        または環境変数 CLAUDE_BIN を設定してください。
echo.
goto :start_server

:server_error
echo.
echo [ERROR] エージェントサーバーが異常終了しました。
pause
exit /b 1
