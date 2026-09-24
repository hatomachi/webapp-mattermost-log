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
 * Project Info compatible with webapp-ai-remote
 */
export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  isGit?: boolean;
}

/**
 * Session Info compatible with webapp-ai-remote
 */
export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  projectId?: string;
  engine?: AIEngine;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * LocalStorage Keys compatible with webapp-ai-remote
 */
export const AI_REMOTE_STORAGE_KEYS = {
  SESSIONS: 'ai_remote_sessions_v1',
  PROJECTS: 'ai_remote_projects_v1',
  MESSAGES_PREFIX: 'ai_remote_msgs_',
  LAST_PROJECT: 'ai_remote_last_project_v1',
} as const;

/**
 * Chat message within the AI Drawer
 */
export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  content?: string; // Compatible with Agent ChatMessage
  attachments?: ContextAttachment[];
  isStreaming?: boolean;
  isError?: boolean;
  timestamp: number | string;
  sessionId?: string;
  engine?: AIEngine;
}
