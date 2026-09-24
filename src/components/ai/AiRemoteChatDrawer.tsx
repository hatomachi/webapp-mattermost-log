import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import { AppSettings } from '../../types/mattermost';
import {
  ContextAttachment,
  AiChatMessage,
  AiRemoteSettings,
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
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [activeAttachments, setActiveAttachments] = useState<ContextAttachment[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(generateUUID);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const assistantMsgIdRef = useRef<string | null>(null);

  // Settings for AI Remote Client
  const clientSettings: AiRemoteSettings = {
    hubUrl: settings.aiHubUrl || 'ws://localhost:8090/ws/client',
    authToken: settings.aiToken || '',
    engine: settings.aiEngine || 'claude',
    model: settings.aiModel || 'claude-opus-4-7',
    transportMode: settings.aiTransportMode || 'auto',
  };

  // Setup AI Remote Client
  const {
    isHubConnected,
    isAgentConnected,
    agentHostname,
    isExecuting,
    activeTransport,
    sendPrompt,
    abort,
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
  });

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

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 150);
    }
  }, [isOpen]);

  // Auto-scroll messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Reset conversation session
  const handleResetSession = () => {
    if (isExecuting) abort();
    setMessages([]);
    setCurrentSessionId(generateUUID());
    setStatusText(null);
    assistantMsgIdRef.current = null;
    // Re-attach current context
    if (getCurrentContextAttachment) {
      const curr = getCurrentContextAttachment();
      if (curr) setActiveAttachments([curr]);
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
    };

    const assistantPlaceholder: AiChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      text: '',
      isStreaming: true,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    if (textOverride === undefined) {
      setInputText('');
    }

    // Attachments are consumed for this turn
    setActiveAttachments([]);

    sendPrompt({
      userPrompt: promptText,
      attachments: currentAttachments,
      sessionId: currentSessionId,
    });
  };

  const handleQuickPromptClick = (qp: QuickPrompt) => {
    // If no attachment is active, try to attach current context first
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] md:w-[520px] bg-zinc-950/98 backdrop-blur-md border-l border-zinc-800 flex flex-col shadow-2xl font-mono text-zinc-100 animate-in slide-in-from-right duration-200 safe-bottom">
      {/* Drawer Header */}
      <div className="h-12 border-b border-zinc-800 px-3 flex items-center justify-between bg-zinc-900/60 shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          <div className="w-6 h-6 rounded bg-emerald-950/80 border border-emerald-700/60 flex items-center justify-center shrink-0">
            <Bot className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-1.5">
              <span className="font-bold text-xs text-zinc-100">AI壁打ち (Remote)</span>
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
                  onClick={reconnect}
                  className="inline-flex items-center space-x-0.5 text-[9px] text-rose-400 bg-rose-950/80 border border-rose-800/80 px-1 py-0.2 rounded hover:bg-rose-900 transition-colors"
                  title="クリックして再接続"
                >
                  <WifiOff className="w-2.5 h-2.5 mr-0.5" />
                  切断中
                </button>
              )}
            </div>
            <span className="text-[10px] text-zinc-400 truncate max-w-[240px]">
              {topicTitle}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
              title="AI接続設定"
              aria-label="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={handleResetSession}
            disabled={isExecuting}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            title="新規会話を開始 (履歴リセット)"
            aria-label="Reset conversation"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            title="閉じる"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Connection Notice Banner if Agent is Disconnected */}
      {!isAgentConnected && (
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
              onClick={onOpenSettings}
              className="text-[10px] text-emerald-400 hover:underline shrink-0 ml-2 font-sans"
            >
              設定を開く
            </button>
          )}
        </div>
      )}

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
            </div>

            {/* Quick Prompts Grid */}
            <div className="w-full max-w-sm grid grid-cols-2 gap-2 text-left pt-2">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.id}
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
              {msg.attachments && msg.attachments.length > 0 && (
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
                        onClick={() => handleCopyText(msg.id, msg.text)}
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
                          onClick={() => handleApplyDraft(msg.id, msg.text)}
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
                  {msg.text || (msg.isStreaming ? '...' : '')}
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
    </div>
  );
};
