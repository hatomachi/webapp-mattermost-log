import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X,
  Bot,
  Send,
  Square,
  RotateCcw,
  Sparkles,
  Paperclip,
  Check,
  Copy,
  ArrowRight,
  Wifi,
  WifiOff,
  AlertCircle,
  HelpCircle,
  CornerDownLeft,
  Settings,
  Plus,
  Key,
  History,
  FolderGit2,
  FolderPlus,
  Folder,
  GitBranch,
  Trash2,
  Clock,
  RefreshCw,
  ChevronLeft,
} from 'lucide-react';
import { AppSettings } from '../../types/mattermost';
import {
  ContextAttachment,
  AiChatMessage,
  AiRemoteSettings,
  ProjectInfo,
  SessionInfo,
  AI_REMOTE_STORAGE_KEYS,
  AIEngine,
} from '../../features/ai/aiRemoteTypes';
import { QUICK_PROMPTS, QuickPrompt } from '../../features/ai/mattermostAiAdapter';
import { useAiRemoteClient } from '../../features/ai/useAiRemoteClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  topicTitle: string;
  initialAttachment?: ContextAttachment | null;
  getCurrentContextAttachment?: () => ContextAttachment | null;
  onApplyDraftToInput?: (text: string) => void;
  onOpenSettings?: () => void;
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Normalize raw messages stored in localStorage or received from remote
 * to guarantee valid AiChatMessage format (safeguards against missing .text property)
 */
function normalizeStoredMessages(rawList: any, sessionId: string): AiChatMessage[] {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((m) => m && typeof m === 'object')
    .map((m: any, idx: number): AiChatMessage => {
      const rawText = typeof m.text === 'string'
        ? m.text
        : (typeof m.content === 'string' ? m.content : '');
      const ts = typeof m.timestamp === 'string'
        ? new Date(m.timestamp).getTime()
        : (typeof m.timestamp === 'number' ? m.timestamp : Date.now());

      return {
        id: m.id || `msg-${sessionId}-${idx}`,
        role: m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user'),
        text: rawText,
        content: rawText,
        attachments: Array.isArray(m.attachments) ? m.attachments : undefined,
        isStreaming: Boolean(m.isStreaming),
        isError: Boolean(m.isError),
        timestamp: isNaN(ts) ? Date.now() : ts,
        sessionId: m.sessionId || sessionId,
        engine: m.engine,
      };
    });
}

export const AiRemoteChatDrawer: React.FC<Props> = ({
  isOpen,
  onClose,
  settings,
  topicTitle,
  initialAttachment,
  getCurrentContextAttachment,
  onApplyDraftToInput,
  onOpenSettings,
}) => {
  // --- 1. Projects state ---
  const [projects, setProjects] = useState<ProjectInfo[]>(() => {
    try {
      const saved = localStorage.getItem(AI_REMOTE_STORAGE_KEYS.PROJECTS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.filter((p) => p && typeof p.path === 'string');
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(() => {
    try {
      const saved = localStorage.getItem(AI_REMOTE_STORAGE_KEYS.PROJECTS);
      const lastId = localStorage.getItem(AI_REMOTE_STORAGE_KEYS.LAST_PROJECT);
      if (saved) {
        const list = JSON.parse(saved);
        if (Array.isArray(list) && list.length > 0) {
          const found = list.find((p) => p && (p.id === lastId || p.path === lastId));
          return found || list[0];
        }
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  });

  // --- 2. Sessions state ---
  const [sessions, setSessions] = useState<SessionInfo[]>(() => {
    try {
      const saved = localStorage.getItem(AI_REMOTE_STORAGE_KEYS.SESSIONS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((s) => s && typeof s.id === 'string');
        }
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    try {
      const savedLast = localStorage.getItem(AI_REMOTE_STORAGE_KEYS.LAST_SESSION);
      if (savedLast && typeof savedLast === 'string' && savedLast.trim().length > 0) {
        return savedLast.trim();
      }
    } catch (e) {
      console.error(e);
    }
    return generateUUID();
  });

  // --- 3. UI and View states ---
  const [isSessionListView, setIsSessionListView] = useState(false);
  const [isAddProjectModalOpen, setIsAddProjectModalOpen] = useState(false);
  const [customProjectPath, setCustomProjectPath] = useState('');
  const [customProjectName, setCustomProjectName] = useState('');
  const [engineFilter, setEngineFilter] = useState<'all' | 'claude' | 'copilot'>('all');

  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [activeAttachments, setActiveAttachments] = useState<ContextAttachment[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const assistantMsgIdRef = useRef<string | null>(null);

  // Settings for AI Remote Client (memoized to prevent unwanted re-renders)
  const clientSettings: AiRemoteSettings = useMemo(() => ({
    hubUrl: settings.aiHubUrl || 'ws://localhost:8090/ws/client',
    authToken: settings.aiToken || '',
    engine: settings.aiEngine || 'claude',
    model: settings.aiModel || 'claude-opus-4-7',
    transportMode: settings.aiTransportMode || 'auto',
  }), [
    settings.aiHubUrl,
    settings.aiToken,
    settings.aiEngine,
    settings.aiModel,
    settings.aiTransportMode,
  ]);

  // Setup AI Remote Client
  const {
    isHubConnected,
    isAgentConnected,
    agentHostname,
    agentCwd,
    availableProjects,
    projectsBaseDir,
    isExecuting,
    activeTransport,
    sendPrompt,
    abort,
    requestProjects,
    listSessions,
    getSessionMessages,
    deleteSession,
    reconnect,
  } = useAiRemoteClient({
    settings: clientSettings,
    onDelta: (delta) => {
      const targetId = assistantMsgIdRef.current;
      if (!targetId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === targetId ? { ...m, text: m.text + delta, isStreaming: true } : m
        )
      );
    },
    onStatusMessage: (msg) => {
      setStatusText(msg);
    },
    onTurnStart: () => {
      setStatusText('思考中・応答を生成中...');
    },
    onTurnEnd: () => {
      setStatusText(null);
      const targetId = assistantMsgIdRef.current;
      if (targetId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === targetId ? { ...m, isStreaming: false } : m))
        );
      }
      assistantMsgIdRef.current = null;
    },
    onError: (err) => {
      setStatusText(null);
      const targetId = assistantMsgIdRef.current;
      if (targetId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === targetId
              ? {
                  ...m,
                  text: m.text ? `${m.text}\n\n⚠️ エラー: ${err}` : `⚠️ エラー: ${err}`,
                  isStreaming: false,
                  isError: true,
                }
              : m
          )
        );
      }
      assistantMsgIdRef.current = null;
    },
    onSessionsList: (remoteSessions) => {
      setSessions((prev) => {
        const remoteIds = new Set(remoteSessions.map((s) => s.id));
        const merged = [
          ...remoteSessions,
          ...prev.filter((s) => !remoteIds.has(s.id)),
        ];
        merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        try {
          localStorage.setItem(AI_REMOTE_STORAGE_KEYS.SESSIONS, JSON.stringify(merged));
        } catch (e) {
          console.error(e);
        }
        return merged;
      });
    },
    onSessionMessages: (sessionId, remoteMsgs) => {
      if (sessionId === currentSessionId && Array.isArray(remoteMsgs) && remoteMsgs.length > 0) {
        const normalized = normalizeStoredMessages(remoteMsgs, sessionId);
        setMessages(normalized);
        try {
          localStorage.setItem(
            `${AI_REMOTE_STORAGE_KEYS.MESSAGES_PREFIX}${sessionId}`,
            JSON.stringify(normalized)
          );
        } catch (e) {
          console.error(e);
        }
      }
    },
  });

  // Load messages from localStorage when currentSessionId changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`${AI_REMOTE_STORAGE_KEYS.MESSAGES_PREFIX}${currentSessionId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        setMessages(normalizeStoredMessages(parsed, currentSessionId));
      } else {
        setMessages([]);
      }
    } catch (e) {
      console.error('Failed to load session messages from storage', e);
      setMessages([]);
      try {
        localStorage.removeItem(AI_REMOTE_STORAGE_KEYS.LAST_SESSION);
      } catch {}
    }
  }, [currentSessionId]);

  // Auto-save messages to localStorage whenever messages change
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;

    // ガード: messages 内のメッセージが現在の currentSessionId と不一致なら保存をスキップ（他セッションの誤上書き防止）
    const hasMismatchedSession = messages.some(
      (m) => m.sessionId && m.sessionId !== currentSessionId
    );
    if (hasMismatchedSession) {
      return;
    }

    try {
      localStorage.setItem(
        `${AI_REMOTE_STORAGE_KEYS.MESSAGES_PREFIX}${currentSessionId}`,
        JSON.stringify(messages)
      );

      // Also update or insert session record
      setSessions((prev) => {
        const existingIdx = prev.findIndex((s) => s.id === currentSessionId);
        const firstUserMsg = messages.find((m) => m.role === 'user');
        const userText = firstUserMsg ? (firstUserMsg.text || firstUserMsg.content || '') : '';
        const autoTitle = userText
          ? (userText.length > 32 ? userText.substring(0, 32) + '...' : userText)
          : (topicTitle || '無題のセッション');

        const nowIso = new Date().toISOString();
        let updated: SessionInfo[];

        if (existingIdx >= 0) {
          const curr = prev[existingIdx];
          updated = [
            ...prev.slice(0, existingIdx),
            {
              ...curr,
              title: curr.title || autoTitle,
              updatedAt: nowIso,
              messageCount: messages.length,
            },
            ...prev.slice(existingIdx + 1),
          ];
        } else {
          const newSession: SessionInfo = {
            id: currentSessionId,
            title: autoTitle,
            cwd: currentProject?.path || agentCwd || '',
            projectId: currentProject?.id,
            engine: settings.aiEngine || 'claude',
            createdAt: nowIso,
            updatedAt: nowIso,
            messageCount: messages.length,
          };
          updated = [newSession, ...prev];
        }

        updated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        localStorage.setItem(AI_REMOTE_STORAGE_KEYS.SESSIONS, JSON.stringify(updated));
        return updated;
      });
    } catch (e) {
      console.error('Failed to save session messages', e);
    }
  }, [messages, currentSessionId, currentProject, agentCwd, settings.aiEngine, topicTitle]);

  // Sync sessions list when agent connects or currentProject changes (avoid redundant project scans)
  useEffect(() => {
    if (isAgentConnected) {
      listSessions(currentProject?.id, currentProject?.path || agentCwd);
    }
  }, [isAgentConnected, currentProject, agentCwd, listSessions]);

  // Set initial attachment when drawer opens
  useEffect(() => {
    if (isOpen) {
      if (initialAttachment) {
        setActiveAttachments((prev) => {
          if (prev.some((a) => a.id === initialAttachment.id)) return prev;
          return [initialAttachment];
        });
      } else if (getCurrentContextAttachment) {
        const curr = getCurrentContextAttachment();
        if (curr) {
          setActiveAttachments((prev) => {
            if (prev.some((a) => a.id === curr.id)) return prev;
            return [curr];
          });
        }
      }
    }
  }, [isOpen, initialAttachment, getCurrentContextAttachment]);

  // Focus input when opened and not in session list view
  useEffect(() => {
    if (isOpen && !isSessionListView) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 150);
    }
  }, [isOpen, isSessionListView]);

  // Auto-scroll messages
  useEffect(() => {
    if (isOpen && !isSessionListView) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isSessionListView]);

  // --- Project Management Functions ---
  const handleSelectProject = (project: ProjectInfo) => {
    setCurrentProject(project);
    try {
      localStorage.setItem(AI_REMOTE_STORAGE_KEYS.LAST_PROJECT, project.id);
    } catch (e) {}

    // Find latest session for this project
    const existing = sessions.find((s) => s.projectId === project.id || s.cwd === project.path);
    if (existing) {
      setCurrentSessionId(existing.id);
      try {
        localStorage.setItem(AI_REMOTE_STORAGE_KEYS.LAST_SESSION, existing.id);
        const cached = localStorage.getItem(`${AI_REMOTE_STORAGE_KEYS.MESSAGES_PREFIX}${existing.id}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          setMessages(normalizeStoredMessages(parsed, existing.id));
        } else {
          setMessages([]);
        }
      } catch (e) {
        setMessages([]);
      }
      if (isAgentConnected) {
        getSessionMessages(existing.id, project.path);
      }
    } else {
      // 既存セッションがない場合、新規UUIDを準備（セッション履歴一覧画面は維持する）
      const newId = generateUUID();
      setCurrentSessionId(newId);
      try {
        localStorage.setItem(AI_REMOTE_STORAGE_KEYS.LAST_SESSION, newId);
      } catch (e) {}
      setMessages([]);
    }

    if (isAgentConnected) {
      listSessions(project.id, project.path);
    }
    // 注意: setIsSessionListView(false) は呼ばない！一覧画面のまま維持する
  };

  const handleAddProject = (project: ProjectInfo) => {
    setProjects((prev) => {
      if (prev.some((p) => p.path === project.path)) return prev;
      const updated = [...prev, project];
      try {
        localStorage.setItem(AI_REMOTE_STORAGE_KEYS.PROJECTS, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const handleRemoveProject = (projectId: string) => {
    setProjects((prev) => {
      const updated = prev.filter((p) => p.id !== projectId);
      try {
        localStorage.setItem(AI_REMOTE_STORAGE_KEYS.PROJECTS, JSON.stringify(updated));
      } catch (e) {}
      if (currentProject?.id === projectId) {
        setCurrentProject(updated.length > 0 ? updated[0] : null);
      }
      return updated;
    });
  };

  const handleAddCustomProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customProjectPath.trim()) return;
    const name = customProjectName.trim() || customProjectPath.trim().split('/').filter(Boolean).pop() || 'Project';
    const newProj: ProjectInfo = {
      id: name,
      name,
      path: customProjectPath.trim(),
    };
    handleAddProject(newProj);
    handleSelectProject(newProj);
    setCustomProjectPath('');
    setCustomProjectName('');
    setIsAddProjectModalOpen(false);
  };

  // --- Session Management Functions ---
  const handleNewSession = (newCwd?: string) => {
    if (isExecuting) abort();
    const newId = generateUUID();
    setCurrentSessionId(newId);
    try {
      localStorage.setItem(AI_REMOTE_STORAGE_KEYS.LAST_SESSION, newId);
    } catch (e) {}
    setMessages([]);
    setStatusText(null);
    assistantMsgIdRef.current = null;
    setIsSessionListView(false);

    // Re-attach current context
    if (getCurrentContextAttachment) {
      const curr = getCurrentContextAttachment();
      if (curr) setActiveAttachments([curr]);
    }
  };

  const handleSelectSession = (session: SessionInfo) => {
    if (isExecuting) abort();
    setCurrentSessionId(session.id);
    try {
      localStorage.setItem(AI_REMOTE_STORAGE_KEYS.LAST_SESSION, session.id);
      const cached = localStorage.getItem(`${AI_REMOTE_STORAGE_KEYS.MESSAGES_PREFIX}${session.id}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        setMessages(normalizeStoredMessages(parsed, session.id));
      } else {
        setMessages([]);
      }
    } catch (e) {
      setMessages([]);
    }

    setIsSessionListView(false);

    // If session has associated project, reflect it
    if (session.projectId || session.cwd) {
      const matched = projects.find((p) => p.id === session.projectId || p.path === session.cwd);
      if (matched && matched.id !== currentProject?.id) {
        setCurrentProject(matched);
        try {
          localStorage.setItem(AI_REMOTE_STORAGE_KEYS.LAST_PROJECT, matched.id);
        } catch (e) {}
      }
    }

    // Request fresh message history from PC agent
    if (isAgentConnected) {
      getSessionMessages(session.id, session.cwd);
    }
  };

  const handleDeleteSession = (sessionId: string) => {
    try {
      localStorage.removeItem(`${AI_REMOTE_STORAGE_KEYS.MESSAGES_PREFIX}${sessionId}`);
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== sessionId);
        localStorage.setItem(AI_REMOTE_STORAGE_KEYS.SESSIONS, JSON.stringify(next));
        return next;
      });
      deleteSession(sessionId);

      if (currentSessionId === sessionId) {
        handleNewSession();
      }
    } catch (e) {
      console.error('Failed to delete session', e);
    }
  };

  const handleRefreshSessions = () => {
    if (isAgentConnected) {
      listSessions(currentProject?.id, currentProject?.path || agentCwd);
    }
  };

  // Remove attachment pill
  const handleRemoveAttachment = (attId: string) => {
    setActiveAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  // Add current screen context attachment
  const handleAddCurrentAttachment = () => {
    if (getCurrentContextAttachment) {
      const curr = getCurrentContextAttachment();
      if (curr) {
        setActiveAttachments((prev) => {
          if (prev.some((a) => a.id === curr.id)) return prev;
          return [...prev, curr];
        });
      }
    }
  };

  // Send message
  const handleSendMessage = (textOverride?: string) => {
    const rawText = textOverride !== undefined ? textOverride : inputText.trim();
    if (!rawText && activeAttachments.length === 0) return;
    if (isExecuting) return;

    if (!isAgentConnected) {
      const warnMsg: AiChatMessage = {
        id: `warn-${Date.now()}`,
        role: 'system',
        text: '社内PCの Bridge Agent に接続されていません。PC上で webapp-ai-remote の start-agent を起動してください。',
        isError: true,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, warnMsg]);
      return;
    }

    const promptText = rawText || '添付された会話ログを分析・要約してください。';
    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;
    assistantMsgIdRef.current = assistantMsgId;

    const currentAttachments = [...activeAttachments];

    const userMessage: AiChatMessage = {
      id: userMsgId,
      role: 'user',
      text: promptText,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
      timestamp: Date.now(),
      sessionId: currentSessionId,
      engine: settings.aiEngine || 'claude',
    };

    const assistantPlaceholder: AiChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      text: '',
      isStreaming: true,
      timestamp: Date.now(),
      sessionId: currentSessionId,
      engine: settings.aiEngine || 'claude',
    };

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    if (textOverride === undefined) {
      setInputText('');
    }

    // Attachments are consumed for this turn
    setActiveAttachments([]);

    const isResume = messages.some((m) => m.role === 'assistant' && !m.isError);
    const targetCwd = currentProject?.path || agentCwd || undefined;

    sendPrompt({
      userPrompt: promptText,
      attachments: currentAttachments,
      sessionId: currentSessionId,
      isResume,
      cwd: targetCwd,
      engine: settings.aiEngine || 'claude',
      model: settings.aiModel || undefined,
    });
  };

  const handleQuickPromptClick = (qp: QuickPrompt) => {
    if (activeAttachments.length === 0 && getCurrentContextAttachment) {
      const curr = getCurrentContextAttachment();
      if (curr) {
        setActiveAttachments([curr]);
        setTimeout(() => {
          handleSendMessage(qp.prompt);
        }, 50);
        return;
      }
    }
    handleSendMessage(qp.prompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleApplyDraft = (id: string, text: string) => {
    if (onApplyDraftToInput) {
      onApplyDraftToInput(text);
      setAppliedId(id);
      setTimeout(() => setAppliedId(null), 2000);
      onClose();
    }
  };

  // Filter sessions by current project
  const projectSessions = sessions.filter((s) => {
    if (!currentProject) return true;
    return s.projectId === currentProject.id || s.cwd === currentProject.path;
  });

  const claudeCount = projectSessions.filter((s) => (s.engine || 'claude') === 'claude').length;
  const copilotCount = projectSessions.filter((s) => s.engine === 'copilot').length;

  const filteredSessions = projectSessions.filter((s) => {
    if (engineFilter === 'all') return true;
    const engine = s.engine || 'claude';
    return engine === engineFilter;
  });

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] md:w-[540px] bg-zinc-950/98 backdrop-blur-md border-l border-zinc-800 flex flex-col shadow-2xl font-mono text-zinc-100 animate-in slide-in-from-right duration-200 safe-bottom">
      {/* Drawer Header */}
      <div className="h-12 border-b border-zinc-800 px-3 flex items-center justify-between bg-zinc-900/60 shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          {isSessionListView ? (
            <button
              type="button"
              onClick={() => setIsSessionListView(false)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors mr-0.5"
              title="チャット画面に戻る"
            >
              <ChevronLeft className="w-5 h-5 text-emerald-400" />
            </button>
          ) : (
            <div className="w-6 h-6 rounded bg-emerald-950/80 border border-emerald-700/60 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
            </div>
          )}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-1.5">
              <span className="font-bold text-xs text-zinc-100">
                {isSessionListView ? 'セッション履歴 & プロジェクト' : 'AI壁打ち (Remote)'}
              </span>
              {isAgentConnected ? (
                <span className="inline-flex items-center space-x-0.5 text-[9px] text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-1 py-0.2 rounded font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-0.5" />
                  {agentHostname || settings.aiEngine || 'Claude'}
                  {activeTransport === 'http' ? ' (SSE)' : ''}
                </span>
              ) : isHubConnected ? (
                <span className="inline-flex items-center space-x-0.5 text-[9px] text-amber-400 bg-amber-950/80 border border-amber-800/80 px-1 py-0.2 rounded font-sans">
                  Hub接続中 (Agent待受)
                </span>
              ) : (
                <button
                  type="button"
                  onClick={reconnect}
                  className="inline-flex items-center space-x-0.5 text-[9px] text-rose-400 bg-rose-950/80 border border-rose-800/80 px-1 py-0.2 rounded hover:bg-rose-900 transition-colors"
                  title="クリックして再接続"
                >
                  <WifiOff className="w-2.5 h-2.5 mr-0.5" />
                  切断中
                </button>
              )}
            </div>
            <div className="flex items-center space-x-1 text-[10px] text-zinc-400 truncate max-w-[240px]">
              {currentProject && (
                <span className="text-emerald-400 font-semibold truncate max-w-[100px]">
                  [{currentProject.name}]
                </span>
              )}
              <span className="truncate">
                {currentSession ? currentSession.title : topicTitle}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          {/* Toggle Session List Button */}
          <button
            type="button"
            onClick={() => setIsSessionListView(!isSessionListView)}
            className={`p-1.5 rounded transition-colors ${
              isSessionListView
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/60'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
            title={isSessionListView ? 'チャット画面へ戻る' : 'セッション一覧を開く'}
            aria-label="Toggle sessions list"
          >
            <History className="w-4 h-4" />
          </button>

          {/* New Session Button */}
          <button
            type="button"
            onClick={() => handleNewSession()}
            disabled={isExecuting}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            title="新規セッションを開始"
            aria-label="New session"
          >
            <Plus className="w-4 h-4" />
          </button>

          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
              title="AI接続設定"
              aria-label="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            title="閉じる"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Connection Notice Banner */}
      {!settings.aiToken ? (
        <div className="bg-amber-950/90 border-b border-amber-800 px-3 py-2 text-amber-200 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-1.5 min-w-0">
            <Key className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            <span className="text-[11px] font-semibold truncate">
              認証キー (Auth Key / Token) が未設定です
            </span>
          </div>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="text-[10px] bg-amber-900/80 hover:bg-amber-800 text-amber-100 border border-amber-700/80 px-2 py-0.5 rounded shrink-0 ml-2 font-sans transition-colors font-bold"
            >
              設定を開く
            </button>
          )}
        </div>
      ) : !isAgentConnected ? (
        <div className="bg-amber-950/70 border-b border-amber-800/70 px-3 py-2 text-amber-200 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-1.5 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            <span className="text-[11px] truncate">
              {!isHubConnected
                ? 'Relay Hub に接続できません。設定を確認してください'
                : '社内PC Bridge Agent が未接続です (PC側 start-agent 起動待ち)'}
            </span>
          </div>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="text-[10px] text-emerald-400 hover:underline shrink-0 ml-2 font-sans"
            >
              設定を開く
            </button>
          )}
        </div>
      ) : null}

      {/* VIEW SWITCH: Session List View OR Chat View */}
      {isSessionListView ? (
        /* --- VIEW B: SESSIONS & PROJECTS MANAGEMENT VIEW --- */
        <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
          {/* 1. Project Selection Section */}
          <div className="p-3 bg-zinc-900/70 border-b border-zinc-800 space-y-2 shrink-0">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="font-semibold uppercase text-[10px] tracking-wider text-zinc-400 flex items-center space-x-1">
                <FolderGit2 className="w-3.5 h-3.5 text-emerald-400 mr-1" />
                プロジェクト一覧 ({projects.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  requestProjects();
                  setIsAddProjectModalOpen(true);
                }}
                className="flex items-center space-x-1 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>PCから追加</span>
              </button>
            </div>

            {/* Registered Projects Badges */}
            <div className="flex space-x-2 overflow-x-auto py-1 no-scrollbar">
              {projects.length === 0 ? (
                <div className="text-[11px] text-zinc-500 py-1">
                  登録済みプロジェクトがありません。「PCから追加」からフォルダを選択してください。
                </div>
              ) : (
                projects.map((proj) => {
                  const isSelected = currentProject?.path === proj.path;
                  return (
                    <div
                      key={proj.path}
                      onClick={() => handleSelectProject(proj)}
                      className={`group relative shrink-0 flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-200 shadow-sm'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-850'
                      }`}
                    >
                      {proj.isGit ? (
                        <GitBranch className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      )}
                      <span className="font-medium truncate max-w-[130px]">{proj.name}</span>

                      {projects.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveProject(proj.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-400 transition-opacity ml-1"
                          title="プロジェクト登録解除"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Selected project full path */}
            {currentProject && (
              <div className="text-[10px] font-mono text-zinc-400 truncate px-1">
                📁 {currentProject.path}
              </div>
            )}
          </div>

          {/* 2. New Session Button for Current Project */}
          <div className="p-3 border-b border-zinc-800 shrink-0 bg-zinc-900/40">
            <button
              type="button"
              onClick={() => handleNewSession()}
              className="w-full flex items-center justify-center space-x-2 py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-md shadow-emerald-950/50 active:scale-[0.98] transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>
                {currentProject ? `「${currentProject.name}」で新規セッション` : '新規セッションを開始'}
              </span>
            </button>
          </div>

          {/* 3. Sessions History Section */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-400 uppercase px-1">
              <span>セッション履歴 ({filteredSessions.length})</span>
              <button
                type="button"
                onClick={handleRefreshSessions}
                disabled={!isAgentConnected}
                className="p-1 rounded text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
                title="セッション一覧を再読み込み"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Engine Segment Filter */}
            <div className="flex bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 text-[10px]">
              <button
                type="button"
                onClick={() => setEngineFilter('all')}
                className={`flex-1 py-1 rounded-md transition-all font-medium ${
                  engineFilter === 'all'
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                すべて ({projectSessions.length})
              </button>
              <button
                type="button"
                onClick={() => setEngineFilter('claude')}
                className={`flex-1 py-1 rounded-md transition-all font-medium ${
                  engineFilter === 'claude'
                    ? 'bg-amber-950/80 text-amber-200 border border-amber-600/40 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Claude ({claudeCount})
              </button>
              <button
                type="button"
                onClick={() => setEngineFilter('copilot')}
                className={`flex-1 py-1 rounded-md transition-all font-medium ${
                  engineFilter === 'copilot'
                    ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-600/40 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Copilot ({copilotCount})
              </button>
            </div>

            {filteredSessions.length === 0 ? (
              <div className="text-center py-10 text-xs text-zinc-500">
                このプロジェクトのセッション履歴はありません
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isActive = session.id === currentSessionId;
                const engine = session.engine || 'claude';
                const dateStr = new Date(session.updatedAt).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={session.id}
                    onClick={() => handleSelectSession(session)}
                    className={`group flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                      isActive
                        ? 'bg-emerald-950/50 border-emerald-500/70 text-emerald-100 shadow-sm'
                        : 'bg-zinc-900/60 border-zinc-800/80 hover:bg-zinc-850 hover:border-zinc-700 text-zinc-300'
                    }`}
                  >
                    <div className="min-w-0 flex-1 mr-2">
                      <div className="flex items-center space-x-1.5">
                        {isActive && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                        <span className="text-xs font-medium truncate flex-1 font-sans">
                          {session.title || '無題のセッション'}
                        </span>
                        {engine === 'copilot' ? (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
                            Copilot
                          </span>
                        ) : (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-500/30">
                            Claude
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-2 text-[10px] text-zinc-400 mt-1">
                        <span className="flex items-center space-x-0.5">
                          <Clock className="w-3 h-3 text-zinc-400" />
                          <span>{dateStr}</span>
                        </span>
                        <span>•</span>
                        <span>{session.messageCount} 発言</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(session.id);
                      }}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 transition-colors"
                      title="セッション削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        /* --- VIEW A: CHAT VIEW --- */
        <>
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 font-sans text-xs">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-4 text-zinc-400">
                <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-emerald-400">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-bold text-zinc-200 text-sm mb-1">MatterLog AI 壁打ち</p>
                  <p className="text-[11px] text-zinc-400 max-w-xs">
                    社内PCの AI エージェント（Claude / Copilot）と会話できます。
                    会話ログを添付して要約や返信案を作成させましょう。
                  </p>
                  {currentProject && (
                    <div className="inline-block mt-2 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-emerald-400 font-mono">
                      作業ディレクトリ: {currentProject.name} ({currentProject.path})
                    </div>
                  )}
                </div>

                {/* Quick Prompts Grid */}
                <div className="w-full max-w-sm grid grid-cols-2 gap-2 text-left pt-2">
                  {QUICK_PROMPTS.map((qp) => (
                    <button
                      key={qp.id}
                      type="button"
                      onClick={() => handleQuickPromptClick(qp)}
                      disabled={isExecuting || !isAgentConnected}
                      className="bg-zinc-900/90 hover:bg-zinc-800/90 border border-zinc-800 rounded p-2 text-left transition-colors flex flex-col space-y-1 group disabled:opacity-50"
                    >
                      <div className="flex items-center space-x-1.5">
                        <span className="text-sm">{qp.icon}</span>
                        <span className="font-semibold text-zinc-200 text-xs group-hover:text-emerald-300">
                          {qp.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-400 line-clamp-2">
                        {qp.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  {/* Attachment badges above user message */}
                  {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {msg.attachments.map((att) => (
                        <span
                          key={att.id}
                          className="inline-flex items-center space-x-1 text-[10px] bg-zinc-900 border border-zinc-700/80 text-emerald-300 px-1.5 py-0.5 rounded font-mono"
                        >
                          <span>📎</span>
                          <span className="font-semibold">{att.title}</span>
                          {att.badge && <span className="text-emerald-400/80">({att.badge})</span>}
                        </span>
                      ))}
                    </div>
                  )}

                  <div
                    className={`max-w-[92%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-emerald-800/80 text-white rounded-br-none shadow-md'
                        : msg.isError
                        ? 'bg-rose-950/80 border border-rose-800 text-rose-200 rounded-bl-none'
                        : 'bg-zinc-900/90 border border-zinc-800 text-zinc-100 rounded-bl-none shadow-md'
                    }`}
                  >
                    {/* Assistant header */}
                    {msg.role === 'assistant' && (
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 pb-1 mb-1.5 border-b border-zinc-800/80 font-mono">
                        <div className="flex items-center space-x-1 text-emerald-400">
                          <Bot className="w-3 h-3" />
                          <span>{settings.aiEngine === 'copilot' ? 'Copilot' : 'Claude'}</span>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopyText(msg.id, msg.text || msg.content || '')}
                            className="hover:text-zinc-200 flex items-center space-x-0.5"
                            title="テキストをコピー"
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">コピー済</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>コピー</span>
                              </>
                            )}
                          </button>

                          {onApplyDraftToInput && (
                            <button
                              type="button"
                              onClick={() => handleApplyDraft(msg.id, msg.text || msg.content || '')}
                              className="hover:text-emerald-300 flex items-center space-x-0.5 text-zinc-300"
                              title="Mattermost返信欄に入力"
                            >
                              {appliedId === msg.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400">セット完了</span>
                                </>
                              ) : (
                                <>
                                  <ArrowRight className="w-3 h-3" />
                                  <span>返信欄へ</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Message body */}
                    <div className="whitespace-pre-wrap break-words">
                      {msg.text || msg.content || (msg.isStreaming ? '...' : '')}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Status Bar */}
          {statusText && (
            <div className="px-3 py-1 bg-zinc-900/90 border-t border-zinc-800 text-[10px] text-emerald-400 flex items-center space-x-1.5 shrink-0 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>{statusText}</span>
            </div>
          )}

          {/* Input Box & Attachments Area */}
          <div className="border-t border-zinc-800 bg-zinc-900/60 p-2.5 shrink-0 space-y-2">
            {/* Active Context Attachments Pills */}
            <div className="flex items-center flex-wrap gap-1.5 min-h-[22px]">
              {activeAttachments.length > 0 ? (
                activeAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center space-x-1.5 bg-emerald-950/80 border border-emerald-700/70 rounded px-2 py-0.5 text-xs text-emerald-300 font-sans"
                  >
                    <span className="text-[11px]">📎</span>
                    <span className="font-semibold text-[11px] truncate max-w-[180px]">{att.title}</span>
                    {att.badge && (
                      <span className="text-[9px] bg-emerald-900/90 text-emerald-200 px-1 rounded">
                        {att.badge}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(att.id)}
                      className="text-emerald-400 hover:text-emerald-100 hover:bg-emerald-900 rounded p-0.5 ml-0.5"
                      title="添付を解除"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))
              ) : (
                getCurrentContextAttachment && (
                  <button
                    type="button"
                    onClick={handleAddCurrentAttachment}
                    className="inline-flex items-center space-x-1 text-[10px] text-zinc-400 hover:text-emerald-300 hover:bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700/60 transition-colors"
                    title="現在の画面ログ（チャンネル/スレッド/未読）を入力欄に添付"
                  >
                    <Plus className="w-3 h-3 text-emerald-400" />
                    <span>現在の画面ログを添付</span>
                  </button>
                )
              )}
            </div>

            {/* Text Input Row */}
            <div className="flex space-x-2">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  !isAgentConnected
                    ? '社内PC Bridge Agent 未接続...'
                    : activeAttachments.length > 0
                    ? '添付ログへの質問・指示を入力 (Enterで送信、Shift+Enterで改行)...'
                    : 'AIへの質問を入力 (Enterで送信、Shift+Enterで改行)...'
                }
                disabled={isExecuting || !isAgentConnected}
                rows={2}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded p-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none font-sans"
              />

              <div className="flex flex-col justify-end space-y-1">
                {isExecuting ? (
                  <button
                    type="button"
                    onClick={abort}
                    className="p-2 bg-rose-600 hover:bg-rose-500 text-white rounded transition-colors shadow-sm"
                    title="生成を中断"
                  >
                    <Square className="w-4 h-4 fill-white" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSendMessage()}
                    disabled={(!inputText.trim() && activeAttachments.length === 0) || !isAgentConnected}
                    className="p-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white rounded transition-colors shadow-sm"
                    title="送信"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal: Add Project from PC Candidates */}
      {isAddProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setIsAddProjectModalOpen(false)}
          />

          <div className="relative w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-4 z-10 select-none text-zinc-200 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800 mb-3">
              <div className="flex items-center space-x-1.5">
                <FolderPlus className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm text-zinc-100">社内PCのフォルダを追加</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddProjectModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* PC Candidate List */}
            <div className="flex-1 overflow-y-auto space-y-2 mb-3 pr-1">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>PC候補 ({projectsBaseDir || '~/work'})</span>
                <button
                  type="button"
                  onClick={() => requestProjects()}
                  className="flex items-center space-x-0.5 text-emerald-400 hover:underline"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>再取得</span>
                </button>
              </div>

              {!isAgentConnected ? (
                <div className="text-center py-4 text-xs text-amber-400/80">
                  PCがオフラインのため候補を取得できません
                </div>
              ) : availableProjects.length === 0 ? (
                <div className="text-center py-4 text-xs text-zinc-500">
                  候補フォルダの読み込み中...
                </div>
              ) : (
                availableProjects.map((p) => {
                  const isAlreadyAdded = projects.some((ep) => ep.path === p.path);
                  return (
                    <div
                      key={p.path}
                      onClick={() => {
                        handleAddProject(p);
                        handleSelectProject(p);
                        setIsAddProjectModalOpen(false);
                      }}
                      className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer ${
                        isAlreadyAdded
                          ? 'bg-zinc-900/50 border-zinc-800/60 opacity-60'
                          : 'bg-zinc-950 border-zinc-800 hover:border-emerald-500/60 hover:bg-zinc-900'
                      }`}
                    >
                      <div className="min-w-0 flex-1 mr-2">
                        <div className="flex items-center space-x-1.5">
                          {p.isGit ? (
                            <GitBranch className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <Folder className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          )}
                          <span className="text-xs font-medium text-zinc-200 truncate">
                            {p.name}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-zinc-400 truncate mt-0.5">
                          {p.path}
                        </div>
                      </div>

                      <span className="text-[10px] px-2 py-1 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 shrink-0">
                        {isAlreadyAdded ? '選択' : '追加'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Custom Path Input Form */}
            <form onSubmit={handleAddCustomProject} className="pt-2.5 border-t border-zinc-800 space-y-2">
              <div className="text-[10px] font-semibold text-zinc-400 uppercase">
                またはパスを直接入力:
              </div>
              <input
                type="text"
                value={customProjectPath}
                onChange={(e) => setCustomProjectPath(e.target.value)}
                placeholder="/path/to/my-project"
                required
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
              >
                手動パスで追加
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
