/**
 * AI Remote Protocol & Attachment Types
 * Compatible with webapp-ai-remote Hub & Agent specifications.
 */

export type AIEngine = 'claude' | 'copilot';
export type TransportMode = 'auto' | 'ws' | 'http';
export type ActiveTransport = 'none' | 'ws' | 'http';

export interface AiRemoteSettings {
  hubUrl: string;
  authToken: string;
  engine: AIEngine;
  model: string;
  transportMode: TransportMode;
}

export const DEFAULT_AI_REMOTE_SETTINGS: AiRemoteSettings = {
  hubUrl: 'ws://localhost:8090/ws/client',
  authToken: '',
  engine: 'claude',
  model: 'claude-opus-4-7',
  transportMode: 'auto',
};

/**
 * Context Attachment attached to a prompt turn
 */
export interface ContextAttachment {
  id: string;
  type: 'channel_log' | 'thread_log' | 'unread_digest' | 'single_post';
  title: string;          // e.g. "#dev-general ログ"
  badge?: string;          // e.g. "45件"
  subtitle?: string;       // e.g. "直近の会話"
  contentMarkdown: string; // The formatted Markdown text injected to prompt
}

/**
 * Chat message within the AI Drawer
 */
export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  attachments?: ContextAttachment[];
  isStreaming?: boolean;
  isError?: boolean;
  timestamp: number;
}
