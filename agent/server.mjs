#!/usr/bin/env node
/**
 * Generic Local AI Agent Server (Node.js ESM)
 * 
 * Provides HTTP/SSE endpoints for web applications (such as webapp-mattermost-log)
 * to converse with local AI coding/reasoning CLI tools (primarily Claude Code).
 * 
 * Features:
 * - Zero external dependencies (Pure Node.js standard library)
 * - Workspace isolation per appId / topicId under ~/.local-ai-agent/workspaces/
 * - Automatic session preservation & resume (--session-id / --resume)
 * - Temporary context file provisioning (./context/*)
 * - Realtime SSE streaming with parsed delta / result / error events
 * - Process lifecycle management (abort on disconnect)
 * - Cross-Origin Resource Sharing (CORS) enabled
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync, exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const isWindows = process.platform === 'win32';

const PORT = parseInt(process.env.PORT || '3456', 10);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_WORKSPACES_DIR = path.join(os.homedir(), '.local-ai-agent', 'workspaces');

// Ensure base workspaces directory exists
try {
  fs.mkdirSync(BASE_WORKSPACES_DIR, { recursive: true });
} catch (err) {
  console.error(`[LocalAgent] Failed to create workspaces dir: ${err.message}`);
}

/**
 * Sanitize an identifier for safe filesystem path usage
 */
function sanitizeIdentifier(id) {
  if (!id || typeof id !== 'string') return 'default';
  // Allow alphanumeric, underscores, hyphens, and dots
  const sanitized = id.replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 100);
  return sanitized || 'default';
}

/**
 * Sanitize context filename to avoid directory traversal
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') return 'context.txt';
  const base = path.basename(filename).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  return base || 'context.txt';
}

/**
 * Resolve Claude Code CLI binary path (Windows & POSIX)
 */
function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) {
    return { binPath: process.env.CLAUDE_BIN, found: true, source: 'env' };
  }

  if (isWindows) {
    // 1. Try 'where claude' on Windows PATH
    try {
      const output = execSync('where claude', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }).trim();
      const firstMatch = output.split(/\r?\n/)[0];
      if (firstMatch && fs.existsSync(firstMatch)) {
        return { binPath: firstMatch, found: true, source: `where claude (${firstMatch})` };
      }
    } catch {}

    // 2. Common Windows paths
    const winCandidates = [
      process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'claude.cmd') : null,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe') : null,
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
      path.join(os.homedir(), '.local', 'bin', 'claude.cmd'),
    ].filter(Boolean);

    for (const candidate of winCandidates) {
      if (fs.existsSync(candidate)) {
        return { binPath: candidate, found: true, source: candidate };
      }
    }

    return { binPath: 'claude.cmd', found: false, source: 'Windows PATH fallback (claude.cmd)' };
  }

  // Linux / macOS candidate paths
  try {
    const whichOut = execSync('which claude', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (whichOut && fs.existsSync(whichOut)) {
      return { binPath: whichOut, found: true, source: `which (${whichOut})` };
    }
  } catch {}

  const posixCandidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
  ];

  // Also check nvm paths
  try {
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir);
      for (const v of versions.reverse()) {
        posixCandidates.push(path.join(nvmDir, v, 'bin', 'claude'));
      }
    }
  } catch {}

  for (const candidate of posixCandidates) {
    if (fs.existsSync(candidate)) {
      return { binPath: candidate, found: true, source: candidate };
    }
  }

  return { binPath: 'claude', found: false, source: 'PATH fallback (claude)' };
}

/**
 * Session persistence helper
 */
function getWorkspaceSession(workspaceDir) {
  const sessionFilePath = path.join(workspaceDir, 'session.json');
  if (fs.existsSync(sessionFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
      if (data && data.sessionId) {
        return data;
      }
    } catch {}
  }
  return null;
}

function saveWorkspaceSession(workspaceDir, sessionData) {
  const sessionFilePath = path.join(workspaceDir, 'session.json');
  try {
    fs.writeFileSync(sessionFilePath, JSON.stringify(sessionData, null, 2), 'utf8');
  } catch (err) {
    console.error(`[LocalAgent] Failed to save session.json: ${err.message}`);
  }
}

/**
 * Write context files into workspace/context/
 */
function writeContextFiles(workspaceDir, contextFiles) {
  const contextDir = path.join(workspaceDir, 'context');
  fs.mkdirSync(contextDir, { recursive: true });

  const writtenFiles = [];
  if (Array.isArray(contextFiles)) {
    for (const file of contextFiles) {
      if (file && typeof file.name === 'string' && typeof file.content === 'string') {
        const safeName = sanitizeFilename(file.name);
        const filePath = path.join(contextDir, safeName);
        fs.writeFileSync(filePath, file.content, 'utf8');
        writtenFiles.push({
          name: safeName,
          path: filePath,
          size: Buffer.byteLength(file.content, 'utf8'),
        });
      }
    }
  }
  return writtenFiles;
}

/**
 * CORS headers
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

/**
 * Main HTTP request handler
 */
const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. GET /health
  if (req.method === 'GET' && pathname === '/health') {
    const claudeInfo = resolveClaudeBin();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        agent: 'local-ai-agent',
        version: '0.1.0',
        platform: process.platform,
        isWindows,
        workspacesDir: BASE_WORKSPACES_DIR,
        claude: claudeInfo,
        uptime: process.uptime(),
      })
    );
    return;
  }

  // 2. GET /api/sessions/:appId/:topicId
  if (req.method === 'GET' && pathname.startsWith('/api/sessions/')) {
    const parts = pathname.slice('/api/sessions/'.length).split('/');
    const appId = sanitizeIdentifier(parts[0]);
    const topicId = sanitizeIdentifier(parts[1]);
    const workspaceDir = path.join(BASE_WORKSPACES_DIR, appId, topicId);

    const session = getWorkspaceSession(workspaceDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        appId,
        topicId,
        workspaceDir,
        session: session || null,
      })
    );
    return;
  }

  // 3. POST /api/sessions/:appId/:topicId/reset
  if (req.method === 'POST' && pathname.startsWith('/api/sessions/') && pathname.endsWith('/reset')) {
    const raw = pathname.slice('/api/sessions/'.length, -'/reset'.length);
    const parts = raw.split('/');
    const appId = sanitizeIdentifier(parts[0]);
    const topicId = sanitizeIdentifier(parts[1]);
    const workspaceDir = path.join(BASE_WORKSPACES_DIR, appId, topicId);

    const newSession = {
      sessionId: randomUUID(),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      resetCount: 1,
    };
    if (fs.existsSync(workspaceDir)) {
      saveWorkspaceSession(workspaceDir, newSession);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, session: newSession }));
    return;
  }

  // 4. POST /api/chat (SSE Streaming)
  if (req.method === 'POST' && pathname === '/api/chat') {
    // Read request body
    let bodyText = '';
    req.on('data', (chunk) => {
      bodyText += chunk;
      // Protect against huge bodies (max 20MB)
      if (bodyText.length > 20 * 1024 * 1024) {
        req.destroy(new Error('Body too large'));
      }
    });

    req.on('end', async () => {
      let params;
      try {
        params = JSON.parse(bodyText);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        return;
      }

      const appId = sanitizeIdentifier(params.appId || 'default');
      const topicId = sanitizeIdentifier(params.topicId || 'general');
      const prompt = (params.prompt || '').trim();
      const contextFiles = params.contextFiles || [];
      const resetSession = Boolean(params.resetSession);
      const systemPrompt = params.systemPrompt;

      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Prompt is required' }));
        return;
      }

      // Set up SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      });

      const sendSSE = (eventObj) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(eventObj)}\n\n`);
        }
      };

      // Prepare workspace directory
      const workspaceDir = path.join(BASE_WORKSPACES_DIR, appId, topicId);
      fs.mkdirSync(workspaceDir, { recursive: true });

      // Save context files into workspace/context/
      let writtenFiles = [];
      try {
        writtenFiles = writeContextFiles(workspaceDir, contextFiles);
      } catch (err) {
        console.error(`[LocalAgent] Error writing context files: ${err.message}`);
      }

      // Manage session ID
      let existingSession = resetSession ? null : getWorkspaceSession(workspaceDir);
      let sessionId = existingSession ? existingSession.sessionId : randomUUID();
      let isResume = Boolean(existingSession);

      const sessionData = {
        sessionId,
        createdAt: existingSession ? existingSession.createdAt : Date.now(),
        lastUsedAt: Date.now(),
        promptCount: (existingSession?.promptCount || 0) + 1,
      };
      saveWorkspaceSession(workspaceDir, sessionData);

      sendSSE({
        type: 'start',
        sessionId,
        isResume,
        workspace: workspaceDir,
        contextFiles: writtenFiles.map((f) => f.name),
      });

      // Resolve Claude CLI
      const claudeInfo = resolveClaudeBin();
      console.log(`[LocalAgent] [${appId}/${topicId}] Starting Claude (${isResume ? 'resume' : 'new'} session: ${sessionId})`);

      // Build args for claude CLI
      // Note: Passing prompt via stdin instead of argv avoids cmd.exe parsing errors
      // (such as "was unexpected at this time") and 8191-character command line limits.
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
      ];

      if (isResume) {
        args.push('--resume', sessionId);
      } else {
        args.push('--session-id', sessionId);
      }

      // Skip interactive permission checks for autonomous local agent use
      args.push('--permission-mode', 'bypassPermissions');

      if (systemPrompt && typeof systemPrompt === 'string') {
        args.push('--system-prompt', systemPrompt);
      }

      let child;
      let isAborted = false;

      // Handle client disconnect -> abort child process
      req.on('close', () => {
        if (!child || child.killed || child.exitCode !== null) return;
        console.log(`[LocalAgent] [${appId}/${topicId}] Client disconnected, aborting Claude process...`);
        isAborted = true;
        try {
          if (isWindows && child.pid) {
            exec(`taskkill /pid ${child.pid} /T /F`, () => {});
          } else {
            child.kill('SIGTERM');
            setTimeout(() => {
              if (child.exitCode === null) {
                child.kill('SIGKILL');
              }
            }, 3000);
          }
        } catch {}
      });

      try {
        child = spawn(claudeInfo.binPath, args, {
          cwd: workspaceDir,
          env: {
            ...process.env,
            // Ensure no interactive prompts hang
            CI: '1',
            FORCE_COLOR: '0',
            PYTHONIOENCODING: 'utf-8',
            LANG: 'ja_JP.UTF-8',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: isWindows,
          windowsHide: true,
        });

        // Write prompt safely into stdin
        child.stdin.end(prompt);
      } catch (err) {
        sendSSE({
          type: 'error',
          error: `Failed to spawn Claude CLI (${claudeInfo.binPath}): ${err.message}`,
        });
        sendSSE({ type: 'done', isError: true });
        res.end();
        return;
      }

      let fullResponseText = '';
      let errorBuffer = '';

      // Read stdout line by line
      const rl = createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const parsed = JSON.parse(trimmed);

          // Handle system init
          if (parsed.type === 'system' && parsed.subtype === 'init') {
            sendSSE({
              type: 'init',
              sessionId: parsed.session_id || sessionId,
              model: parsed.model,
              tools: parsed.tools,
            });
            return;
          }

          // Handle content_block_delta (text chunk)
          if (parsed.type === 'content_block_delta') {
            const deltaText = parsed.delta?.text || '';
            if (deltaText) {
              fullResponseText += deltaText;
              sendSSE({ type: 'delta', text: deltaText });
            }
            return;
          }

          // Handle assistant message (full or partial turn)
          if (parsed.type === 'assistant' && parsed.message) {
            const contents = parsed.message.content || [];
            let assistantText = '';
            for (const item of contents) {
              if (item.type === 'text') {
                assistantText += item.text;
              }
            }
            // If delta was not streamed or this contains full message
            if (assistantText && !fullResponseText) {
              fullResponseText = assistantText;
              sendSSE({ type: 'delta', text: assistantText });
            }
            if (parsed.error) {
              sendSSE({
                type: 'error',
                error: typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error),
                details: assistantText,
              });
            }
            return;
          }

          // Handle tool use / status updates
          if (parsed.type === 'tool_use' || (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use')) {
            const toolName = parsed.name || parsed.content_block?.name || 'tool';
            sendSSE({ type: 'status', message: `Claude is using tool: ${toolName}...` });
            return;
          }

          // Handle final result event
          if (parsed.type === 'result') {
            if (parsed.is_error) {
              sendSSE({
                type: 'error',
                error: parsed.result || 'Claude execution failed',
                duration_ms: parsed.duration_ms,
              });
            } else {
              if (parsed.result && !fullResponseText) {
                fullResponseText = parsed.result;
                sendSSE({ type: 'delta', text: parsed.result });
              }
              sendSSE({
                type: 'done',
                result: parsed.result || fullResponseText,
                cost: parsed.total_cost_usd,
                duration_ms: parsed.duration_ms,
                num_turns: parsed.num_turns,
              });
            }
            return;
          }

          // Forward other events for debugging
          sendSSE({ type: 'raw', data: parsed });
        } catch {
          // If line is not JSON, might be raw console log or debug output
          if (trimmed.startsWith('Error:')) {
            sendSSE({ type: 'error', error: trimmed });
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        errorBuffer += text;
        console.error(`[LocalAgent:stderr] ${text}`);
      });

      child.on('error', (err) => {
        console.error(`[LocalAgent] Process error: ${err.message}`);
        sendSSE({ type: 'error', error: `Process error: ${err.message}` });
        sendSSE({ type: 'done', isError: true });
        res.end();
      });

      child.on('close', (code) => {
        console.log(`[LocalAgent] [${appId}/${topicId}] Claude process exited with code ${code}`);
        if (code !== 0 && !fullResponseText && !isAborted) {
          const errMsg = errorBuffer.trim() || `Claude CLI exited with code ${code}`;
          sendSSE({ type: 'error', error: errMsg });
        }
        sendSSE({
          type: 'done',
          exitCode: code,
          fullText: fullResponseText,
          aborted: isAborted,
        });
        res.end();
      });
    });
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log(`🚀 [LocalAgent] Server listening on http://${HOST}:${PORT}`);
  console.log(`📁 Workspaces: ${BASE_WORKSPACES_DIR}`);
  const claudeInfo = resolveClaudeBin();
  console.log(`🤖 Claude CLI: ${claudeInfo.found ? `Found (${claudeInfo.source})` : '⚠️ Not found in standard paths'}`);
  console.log('='.repeat(60));
});
