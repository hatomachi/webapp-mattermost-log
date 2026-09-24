/**
 * AI Remote Client Hook for webapp-mattermost-log
 * 
 * Connects to webapp-ai-remote Relay Hub (WSS or SSE+POST fallback)
 * to converse with the PC-resident Bridge Agent (Claude Code / Copilot CLI).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AiRemoteSettings,
  DEFAULT_AI_REMOTE_SETTINGS,
  ActiveTransport,
  ContextAttachment,
} from './aiRemoteTypes';
import { composeFullPrompt } from './mattermostAiAdapter';

export interface InboundHubMessage {
  type: string;
  [key: string]: any;
}

export function deriveHttpUrls(hubWsUrl: string, authToken: string) {
  try {
    const parsed = new URL(hubWsUrl);
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';

    let basePath = parsed.pathname;
    if (basePath.endsWith('/ws/client')) {
      basePath = basePath.substring(0, basePath.length - '/ws/client'.length);
    }
    if (basePath.endsWith('/')) {
      basePath = basePath.substring(0, basePath.length - 1);
    }

    const eventsUrl = new URL(parsed.toString());
    eventsUrl.pathname = `${basePath}/events`;
    if (authToken) eventsUrl.searchParams.set('token', authToken);

    const messageUrl = new URL(parsed.toString());
    messageUrl.pathname = `${basePath}/message`;
    if (authToken) messageUrl.searchParams.set('token', authToken);

    return {
      eventsUrl: eventsUrl.toString(),
      messageUrl: messageUrl.toString(),
    };
  } catch {
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const base = `${isHttps ? 'https:' : 'http:'}//${typeof window !== 'undefined' ? window.location.host : 'localhost:8090'}`;
    const tokenQuery = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
    return {
      eventsUrl: `${base}/events${tokenQuery}`,
      messageUrl: `${base}/message${tokenQuery}`,
    };
  }
}

export interface UseAiRemoteClientOptions {
  settings: AiRemoteSettings;
  onDelta?: (text: string) => void;
  onStatusMessage?: (message: string) => void;
  onTurnStart?: () => void;
  onTurnEnd?: () => void;
  onError?: (error: string) => void;
}

export function useAiRemoteClient(options: UseAiRemoteClientOptions) {
  const { settings, onDelta, onStatusMessage, onTurnStart, onTurnEnd, onError } = options;

  const [isHubConnected, setIsHubConnected] = useState(false);
  const [isAgentConnected, setIsAgentConnected] = useState(false);
  const [agentHostname, setAgentHostname] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeTransport, setActiveTransport] = useState<ActiveTransport>('none');

  const wsRef = useRef<WebSocket | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<any>(null);
  const fallbackTimerRef = useRef<any>(null);

  const callbacksRef = useRef({ onDelta, onStatusMessage, onTurnStart, onTurnEnd, onError });
  callbacksRef.current = { onDelta, onStatusMessage, onTurnStart, onTurnEnd, onError };

  // POST HTTP Message (for SSE+POST fallback)
  const postHttpMessage = useCallback(async (msg: any, messageUrl: string) => {
    try {
      const res = await fetch(messageUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
      return res.ok;
    } catch (err) {
      console.error('[AiRemoteClient] Failed to send HTTP POST message:', err);
      return false;
    }
  }, []);

  // Handle incoming message from Hub/Agent
  const handleInboundMessage = useCallback((msg: InboundHubMessage, sendReply: (out: any) => void) => {
    if (msg.type === 'status') {
      setIsAgentConnected(Boolean(msg.agentConnected));
      if (!msg.agentConnected) {
        setIsExecuting(false);
      }
    } else if (msg.type === 'agent_hello') {
      setIsAgentConnected(true);
      if (msg.hostname) setAgentHostname(msg.hostname);
    } else if (msg.type === 'agent_status') {
      setIsAgentConnected(true);
      if (msg.hostname) setAgentHostname(msg.hostname);
      setIsExecuting(Boolean(msg.isBusy));
    } else if (msg.type === 'turn_start') {
      setIsExecuting(true);
      callbacksRef.current.onTurnStart?.();
    } else if (msg.type === 'claude_event') {
      const ev = msg.event;
      if (!ev) return;

      // 1) Delta text stream
      if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta') {
        const delta = ev.event.delta?.text || '';
        if (delta) callbacksRef.current.onDelta?.(delta);
      }

      // 2) Tool use notice
      if (ev.type === 'assistant' && ev.message?.content) {
        const toolBlocks = ev.message.content.filter((b: any) => b.type === 'tool_use');
        for (const tb of toolBlocks) {
          callbacksRef.current.onStatusMessage?.(`ツール実行中: ${tb.name}...`);
        }
      }

      // 3) Tool result
      if (ev.type === 'user' && ev.message?.content) {
        callbacksRef.current.onStatusMessage?.('ツール実行結果を解析中...');
      }
    } else if (msg.type === 'turn_end' || msg.type === 'execution_aborted') {
      setIsExecuting(false);
      callbacksRef.current.onTurnEnd?.();
    } else if (msg.type === 'turn_error') {
      setIsExecuting(false);
      callbacksRef.current.onError?.(msg.error || 'AI実行中にエラーが発生しました');
    }
  }, []);

  // Cleanup connections
  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setActiveTransport('none');
  }, []);

  // HTTP (SSE + POST) Connect
  const connectHttp = useCallback(() => {
    cleanup();
    const { hubUrl, authToken } = settings;
    if (!hubUrl || !authToken) {
      setIsHubConnected(false);
      setIsAgentConnected(false);
      return;
    }

    try {
      const { eventsUrl, messageUrl } = deriveHttpUrls(hubUrl, authToken);
      console.log('[AiRemoteClient] Connecting via HTTP (SSE):', eventsUrl);

      const es = new EventSource(eventsUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        console.log('[AiRemoteClient] Connected via HTTP (SSE)');
        setIsHubConnected(true);
        setActiveTransport('http');
        postHttpMessage({ type: 'get_status' }, messageUrl);
      };

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleInboundMessage(msg, (out) => postHttpMessage(out, messageUrl));
        } catch (err) {
          console.error('[AiRemoteClient] Failed to parse SSE message:', err);
        }
      };

      es.onerror = (err) => {
        console.warn('[AiRemoteClient] SSE disconnected:', err);
        setIsHubConnected(false);
        setIsAgentConnected(false);
        setIsExecuting(false);
      };
    } catch (e) {
      console.error('[AiRemoteClient] SSE create failed:', e);
      reconnectTimerRef.current = setTimeout(connectHttp, 4000);
    }
  }, [settings, cleanup, postHttpMessage, handleInboundMessage]);

  // WebSocket Connect
  const connectWs = useCallback(() => {
    cleanup();
    const { hubUrl, authToken, transportMode = 'auto' } = settings;
    if (!hubUrl || !authToken) {
      setIsHubConnected(false);
      setIsAgentConnected(false);
      return;
    }

    try {
      const urlObj = new URL(hubUrl);
      if (authToken) {
        urlObj.searchParams.set('token', authToken);
      }

      console.log('[AiRemoteClient] Connecting via WebSocket:', urlObj.toString());
      const ws = new WebSocket(urlObj.toString());
      wsRef.current = ws;

      if (transportMode === 'auto') {
        fallbackTimerRef.current = setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
            console.warn('[AiRemoteClient] WS handshake timeout (3.5s). Falling back to HTTP (SSE+POST)...');
            connectHttp();
          }
        }, 3500);
      }

      ws.onopen = () => {
        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
        console.log('[AiRemoteClient] Connected to Hub via WebSocket');
        setIsHubConnected(true);
        setActiveTransport('ws');
        ws.send(JSON.stringify({ type: 'get_status' }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleInboundMessage(msg, (out) => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify(out));
            }
          });
        } catch (err) {
          console.error('[AiRemoteClient] Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        console.warn('[AiRemoteClient] WebSocket disconnected.');
        setIsHubConnected(false);
        setIsAgentConnected(false);
        setIsExecuting(false);
        setActiveTransport('none');
        wsRef.current = null;

        if (transportMode === 'auto') {
          console.log('[AiRemoteClient] Switching to HTTP (SSE+POST)...');
          connectHttp();
        } else {
          reconnectTimerRef.current = setTimeout(connectWs, 3000);
        }
      };

      ws.onerror = (err) => {
        console.error('[AiRemoteClient] WebSocket error:', err);
        if (transportMode === 'auto') {
          if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
          }
          connectHttp();
        }
      };
    } catch (e) {
      console.error('[AiRemoteClient] WebSocket init error:', e);
      if (transportMode === 'auto') {
        connectHttp();
      } else {
        reconnectTimerRef.current = setTimeout(connectWs, 3000);
      }
    }
  }, [settings, cleanup, connectHttp, handleInboundMessage]);

  // Main Connect
  const connect = useCallback(() => {
    if (settings.transportMode === 'http') {
      connectHttp();
    } else {
      connectWs();
    }
  }, [settings.transportMode, connectWs, connectHttp]);

  // Reconnect on visibility change
  useEffect(() => {
    connect();
    return () => cleanup();
  }, [connect, cleanup]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        if (!isHubConnected) {
          connect();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isHubConnected, connect]);

  // Send general message
  const send = useCallback((msg: any) => {
    if (activeTransport === 'ws' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    } else if (activeTransport === 'http') {
      const { hubUrl, authToken } = settings;
      const { messageUrl } = deriveHttpUrls(hubUrl, authToken);
      postHttpMessage(msg, messageUrl);
      return true;
    }
    return false;
  }, [activeTransport, settings, postHttpMessage]);

  // Send prompt turn with attachments
  const sendPrompt = useCallback((params: {
    userPrompt: string;
    attachments?: ContextAttachment[];
    sessionId?: string;
  }) => {
    const { userPrompt, attachments, sessionId } = params;
    const fullPrompt = composeFullPrompt(userPrompt, attachments);

    const payload = {
      type: 'prompt',
      text: fullPrompt,
      sessionId,
      engine: settings.engine || 'claude',
      model: settings.model || undefined,
      permissionMode: 'acceptEdits',
    };

    const ok = send(payload);
    if (ok) {
      setIsExecuting(true);
    }
    return ok;
  }, [send, settings.engine, settings.model]);

  // Abort current turn
  const abort = useCallback(() => {
    return send({ type: 'abort' });
  }, [send]);

  return {
    isHubConnected,
    isAgentConnected,
    agentHostname,
    isExecuting,
    activeTransport,
    sendPrompt,
    abort,
    reconnect: connect,
  };
}
