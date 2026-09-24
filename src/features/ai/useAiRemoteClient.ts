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
    let rawUrl = hubWsUrl.trim();
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://') && !rawUrl.startsWith('ws://') && !rawUrl.startsWith('wss://')) {
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      rawUrl = `${isHttps ? 'https:' : 'http:'}//${rawUrl}`;
    }

    const parsed = new URL(rawUrl);
    // wss: or https: -> https:, ws: or http: -> http:
    parsed.protocol = (parsed.protocol === 'wss:' || parsed.protocol === 'https:') ? 'https:' : 'http:';

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

export function deriveWsUrl(hubUrl: string, authToken: string): string {
  try {
    let wsUrlStr = hubUrl.trim();
    if (wsUrlStr.startsWith('http://')) {
      wsUrlStr = 'ws://' + wsUrlStr.slice('http://'.length);
    } else if (wsUrlStr.startsWith('https://')) {
      wsUrlStr = 'wss://' + wsUrlStr.slice('https://'.length);
    } else if (!wsUrlStr.startsWith('ws://') && !wsUrlStr.startsWith('wss://')) {
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      wsUrlStr = `${isHttps ? 'wss:' : 'ws:'}//${wsUrlStr}`;
    }

    const parsed = new URL(wsUrlStr);
    if (!parsed.pathname || parsed.pathname === '/') {
      parsed.pathname = '/ws/client';
    }
    if (authToken) {
      parsed.searchParams.set('token', authToken);
    }
    return parsed.toString();
  } catch {
    return hubUrl;
  }
}

// Exponential backoff configuration
const RECONNECT_BASE_DELAY_MS = 2000;    // Minimum wait: 2000ms (no immediate reconnect)
const RECONNECT_MAX_DELAY_MS = 30000;    // Max wait: 30s
const RECONNECT_BACKOFF_FACTOR = 1.5;    // Multiplier: 1.5x
const RECONNECT_JITTER_RATIO = 0.2;      // Jitter: ±20%
const STATUS_REQUEST_THROTTLE_MS = 2000; // Throttle get_status requests: at least 2s

function calculateBackoffDelay(retryCount: number): number {
  const exponential = RECONNECT_BASE_DELAY_MS * Math.pow(RECONNECT_BACKOFF_FACTOR, retryCount);
  const capped = Math.min(exponential, RECONNECT_MAX_DELAY_MS);
  const jitter = capped * RECONNECT_JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(RECONNECT_BASE_DELAY_MS, Math.round(capped + jitter));
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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const lastStatusSentTimeRef = useRef(0);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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

  // Cleanup all connections and timers
  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (resetRetryTimerRef.current) {
      clearTimeout(resetRetryTimerRef.current);
      resetRetryTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    if (eventSourceRef.current) {
      // Must detach all listeners before closing to prevent browser ghost events
      eventSourceRef.current.onopen = null;
      eventSourceRef.current.onmessage = null;
      eventSourceRef.current.onerror = null;
      try {
        eventSourceRef.current.close();
      } catch {
        // ignore
      }
      eventSourceRef.current = null;
    }
    setActiveTransport('none');
  }, []);

  // Stable connection handler: reset retry count after maintaining connection for 5s
  const onConnectionEstablished = useCallback((transport: 'ws' | 'http') => {
    setIsHubConnected(true);
    setActiveTransport(transport);

    if (resetRetryTimerRef.current) {
      clearTimeout(resetRetryTimerRef.current);
    }
    resetRetryTimerRef.current = setTimeout(() => {
      resetRetryTimerRef.current = null;
      retryCountRef.current = 0;
      console.log('[AiRemoteClient] Connection has been stable for 5s. Reset retry counter.');
    }, 5000);
  }, []);

  // Forward declarations for connect functions
  const connectHttpRef = useRef<() => void>(() => {});
  const connectWsRef = useRef<() => void>(() => {});

  // Schedule reconnect with exponential backoff & jitter (strictly forbids immediate reconnection)
  const scheduleReconnect = useCallback((targetMode?: 'ws' | 'http') => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const currentRetry = retryCountRef.current;
    const delay = calculateBackoffDelay(currentRetry);
    retryCountRef.current = currentRetry + 1;

    console.log(`[AiRemoteClient] Scheduling reconnect in ${delay}ms (attempt #${currentRetry + 1})`);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (targetMode === 'http') {
        connectHttpRef.current();
      } else if (targetMode === 'ws') {
        connectWsRef.current();
      } else {
        const mode = settingsRef.current.transportMode || 'auto';
        if (mode === 'http') {
          connectHttpRef.current();
        } else {
          connectWsRef.current();
        }
      }
    }, delay);
  }, []);

  // HTTP (SSE + POST) Connect: GUARANTEES AT MOST ONE SSE CONNECTION
  const connectHttp = useCallback(() => {
    cleanup();
    const { hubUrl, authToken } = settingsRef.current;
    if (!hubUrl || !authToken) {
      setIsHubConnected(false);
      setIsAgentConnected(false);
      return;
    }

    try {
      const { eventsUrl, messageUrl } = deriveHttpUrls(hubUrl, authToken);
      console.log('[AiRemoteClient] Connecting via HTTP (SSE):', eventsUrl);

      // EventSource singleton: previous instance is closed in cleanup()
      const es = new EventSource(eventsUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        console.log('[AiRemoteClient] Connected via HTTP (SSE)');
        onConnectionEstablished('http');

        // Throttled initial get_status (at least 2s apart)
        const now = Date.now();
        if (now - lastStatusSentTimeRef.current >= STATUS_REQUEST_THROTTLE_MS) {
          lastStatusSentTimeRef.current = now;
          postHttpMessage({ type: 'get_status' }, messageUrl);
        }
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
        console.warn('[AiRemoteClient] SSE disconnected or error:', err);
        setIsHubConnected(false);
        setIsAgentConnected(false);
        setIsExecuting(false);

        // CRITICAL: Close EventSource immediately to kill browser's native rapid retry loop!
        if (eventSourceRef.current) {
          eventSourceRef.current.onopen = null;
          eventSourceRef.current.onmessage = null;
          eventSourceRef.current.onerror = null;
          try {
            eventSourceRef.current.close();
          } catch {
            // ignore
          }
          eventSourceRef.current = null;
        }

        // Schedule next connection using exponential backoff (no immediate retry)
        scheduleReconnect('http');
      };
    } catch (e) {
      console.error('[AiRemoteClient] SSE creation failed:', e);
      scheduleReconnect('http');
    }
  }, [cleanup, onConnectionEstablished, handleInboundMessage, postHttpMessage, scheduleReconnect]);

  connectHttpRef.current = connectHttp;

  // WebSocket Connect
  const connectWs = useCallback(() => {
    cleanup();
    const { hubUrl, authToken, transportMode = 'auto' } = settingsRef.current;
    if (!hubUrl || !authToken) {
      setIsHubConnected(false);
      setIsAgentConnected(false);
      return;
    }

    try {
      const wsUrl = deriveWsUrl(hubUrl, authToken);
      console.log('[AiRemoteClient] Connecting via WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      let hasHandshakeTimedOut = false;

      if (transportMode === 'auto') {
        fallbackTimerRef.current = setTimeout(() => {
          fallbackTimerRef.current = null;
          if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
            console.warn('[AiRemoteClient] WS handshake timeout (3.5s). Falling back to HTTP (SSE+POST)...');
            hasHandshakeTimedOut = true;
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
        onConnectionEstablished('ws');
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

        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }

        if (hasHandshakeTimedOut) {
          // Already falling back to HTTP
          return;
        }

        // Reconnect with exponential backoff; no immediate reconnection allowed
        if (transportMode === 'auto') {
          console.log('[AiRemoteClient] WebSocket closed in auto mode. Scheduling HTTP fallback with backoff...');
          scheduleReconnect('http');
        } else {
          scheduleReconnect('ws');
        }
      };

      ws.onerror = (err) => {
        console.error('[AiRemoteClient] WebSocket error:', err);
        // Do NOT trigger reconnection here; ws.onclose fires immediately after onerror.
        // Centralizing reconnect handling in ws.onclose prevents duplicate connection attempts.
      };
    } catch (e) {
      console.error('[AiRemoteClient] WebSocket init error:', e);
      if (transportMode === 'auto') {
        scheduleReconnect('http');
      } else {
        scheduleReconnect('ws');
      }
    }
  }, [cleanup, onConnectionEstablished, handleInboundMessage, connectHttp, scheduleReconnect]);

  connectWsRef.current = connectWs;

  // Main Connect dispatcher
  const connect = useCallback(() => {
    const mode = settingsRef.current.transportMode || 'auto';
    if (mode === 'http') {
      connectHttp();
    } else {
      connectWs();
    }
  }, [connectHttp, connectWs]);

  // Track connection settings changes explicitly to prevent unwanted reconnections on general re-renders
  const prevConfigRef = useRef({
    hubUrl: settings.hubUrl,
    authToken: settings.authToken,
    transportMode: settings.transportMode,
  });

  useEffect(() => {
    const prev = prevConfigRef.current;
    const curr = {
      hubUrl: settings.hubUrl,
      authToken: settings.authToken,
      transportMode: settings.transportMode,
    };

    const isChanged =
      prev.hubUrl !== curr.hubUrl ||
      prev.authToken !== curr.authToken ||
      prev.transportMode !== curr.transportMode;

    prevConfigRef.current = curr;

    if (isChanged) {
      console.log('[AiRemoteClient] Settings changed. Re-establishing connection...');
      retryCountRef.current = 0;
      cleanup();
      connect();
    }
  }, [settings.hubUrl, settings.authToken, settings.transportMode, cleanup, connect]);

  // Initial connection on mount
  useEffect(() => {
    connect();
    return () => {
      cleanup();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Visibility change handling: safe restoration without flood
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return;

      if (document.visibilityState === 'visible') {
        console.log('[AiRemoteClient] Page visible again.');
        // If not connected and no reconnect timer is currently running, schedule with backoff
        if (!wsRef.current && !eventSourceRef.current && !reconnectTimerRef.current) {
          scheduleReconnect();
        } else if (eventSourceRef.current && activeTransport === 'http') {
          // Throttled status probe
          const now = Date.now();
          if (now - lastStatusSentTimeRef.current >= STATUS_REQUEST_THROTTLE_MS) {
            lastStatusSentTimeRef.current = now;
            const { hubUrl, authToken } = settingsRef.current;
            const { messageUrl } = deriveHttpUrls(hubUrl, authToken);
            postHttpMessage({ type: 'get_status' }, messageUrl);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [activeTransport, scheduleReconnect, postHttpMessage]);

  // Send general message
  const send = useCallback((msg: any) => {
    if (activeTransport === 'ws' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    } else if (activeTransport === 'http') {
      const { hubUrl, authToken } = settingsRef.current;
      const { messageUrl } = deriveHttpUrls(hubUrl, authToken);
      postHttpMessage(msg, messageUrl);
      return true;
    }
    return false;
  }, [activeTransport, postHttpMessage]);

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
      engine: settingsRef.current.engine || 'claude',
      model: settingsRef.current.model || undefined,
      permissionMode: 'acceptEdits',
    };

    const ok = send(payload);
    if (ok) {
      setIsExecuting(true);
    }
    return ok;
  }, [send]);

  // Abort current turn
  const abort = useCallback(() => {
    return send({ type: 'abort' });
  }, [send]);

  // Manual reconnect handler (resets backoff)
  const manualReconnect = useCallback(() => {
    console.log('[AiRemoteClient] Manual reconnect requested.');
    retryCountRef.current = 0;
    cleanup();
    connect();
  }, [cleanup, connect]);

  return {
    isHubConnected,
    isAgentConnected,
    agentHostname,
    isExecuting,
    activeTransport,
    sendPrompt,
    abort,
    reconnect: manualReconnect,
  };
}
