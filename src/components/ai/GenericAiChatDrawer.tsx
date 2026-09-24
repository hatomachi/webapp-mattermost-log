import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Bot,
  Send,
  Square,
  RotateCcw,
  Sparkles,
  FileText,
  ChevronDown,
  ChevronUp,
  Check,
  Copy,
  ArrowRight,
  Wifi,
  WifiOff,
  AlertCircle,
  HelpCircle,
  CornerDownLeft,
} from 'lucide-react';
import { ContextFile, QUICK_PROMPTS, QuickPrompt } from '../../features/ai/mattermostAiAdapter';

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  isError?: boolean;
  timestamp: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  agentUrl?: string;
  appId?: string;
  topicId: string;
  topicTitle: string;
  contextFile?: ContextFile | null;
  onApplyDraftToInput?: (text: string) => void;
}

export const GenericAiChatDrawer: React.FC<Props> = ({
  isOpen,
  onClose,
  agentUrl = 'http://localhost:3456',
  appId = 'webapp-mattermost-log',
  topicId,
  topicTitle,
  contextFile,
  onApplyDraftToInput,
}) => {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [includeContext, setIncludeContext] = useState(true);
  const [isContextPreviewOpen, setIsContextPreviewOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  // Agent Health State
  const [agentStatus, setAgentStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [agentDetails, setAgentDetails] = useState<{
    version?: string;
    platform?: string;
    isWindows?: boolean;
    claudeFound?: boolean;
    claudeSource?: string;
  }>({});

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Check agent health
  const checkHealth = useCallback(async () => {
    setAgentStatus('checking');
    try {
      const cleanUrl = agentUrl.replace(/\/+$/, '');
      const res = await fetch(`${cleanUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        setAgentStatus('connected');
        setAgentDetails({
          version: data.version,
          platform: data.platform,
          isWindows: data.isWindows,
          claudeFound: data.claude?.found,
          claudeSource: data.claude?.source,
        });
      } else {
        setAgentStatus('disconnected');
      }
    } catch {
      setAgentStatus('disconnected');
    }
  }, [agentUrl]);

  useEffect(() => {
    if (isOpen) {
      checkHealth();
    }
  }, [isOpen, checkHealth]);

  // Auto-scroll messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Focus textarea when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 150);
    }
  }, [isOpen]);

  // Clear conversation state when topicId changes
  useEffect(() => {
    if (isGenerating) {
      abortControllerRef.current?.abort();
      setIsGenerating(false);
    }
    setMessages([]);
    setStatusText(null);
  }, [topicId]);

  // Reset session handler
  const handleResetSession = async () => {
    if (isGenerating) {
      abortControllerRef.current?.abort();
      setIsGenerating(false);
    }
    setStatusText(null);

    try {
      const cleanUrl = agentUrl.replace(/\/+$/, '');
      await fetch(`${cleanUrl}/api/sessions/${appId}/${topicId}/reset`, {
        method: 'POST',
      });
    } catch (e) {
      console.warn('Failed to call session reset on server:', e);
    }

    setMessages([
      {
        id: `sys-${Date.now()}`,
        role: 'system',
        text: '✨ セッションをリセットしました。新しい文脈で会話を開始できます。',
        timestamp: Date.now(),
      },
    ]);
  };

  // Copy message text to clipboard
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Apply draft text to Mattermost post input
  const handleApplyDraft = (id: string, text: string) => {
    if (onApplyDraftToInput) {
      onApplyDraftToInput(text);
      setAppliedId(id);
      setTimeout(() => setAppliedId(null), 2500);
    }
  };

  // Send message to local agent via SSE
  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = (customPrompt || inputText).trim();
    if (!textToSend || isGenerating) return;

    if (!customPrompt) {
      setInputText('');
    }

    // Add user message
    const userMsgId = `user-${Date.now()}`;
    const userMessage: AiChatMessage = {
      id: userMsgId,
      role: 'user',
      text: textToSend,
      timestamp: Date.now(),
    };

    // Prepare assistant placeholder message
    const assistantMsgId = `assistant-${Date.now()}`;
    const assistantMessage: AiChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      text: '',
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsGenerating(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const cleanUrl = agentUrl.replace(/\/+$/, '');

      // Build context files payload
      const contextFiles = [];
      if (includeContext && contextFile) {
        contextFiles.push({
          name: contextFile.name,
          content: contextFile.content,
        });
      }

      const response = await fetch(`${cleanUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId,
          topicId,
          prompt: textToSend,
          contextFiles,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6);
          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'delta' && event.text) {
              accumulatedText += event.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, text: accumulatedText } : m
                )
              );
            } else if (event.type === 'replace' && event.text) {
              accumulatedText = event.text;
              setStatusText(null);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, text: accumulatedText } : m
                )
              );
            } else if (event.type === 'status' && event.message) {
              setStatusText(event.message);
            } else if (event.type === 'error') {
              setStatusText(null);
              const errMsg = event.error || '不明なエラーが発生しました';
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        text: accumulatedText ? `${accumulatedText}\n\n⚠️ ${errMsg}` : `⚠️ ${errMsg}`,
                        isError: true,
                      }
                    : m
                )
              );
            } else if (event.type === 'done') {
              setStatusText(null);
              if (event.result) {
                accumulatedText = event.result;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, text: event.result } : m
                  )
                );
              }
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, text: m.text ? `${m.text}\n\n*(生成を中断しました)*` : '*(生成を中断しました)*' }
              : m
          )
        );
      } else {
        const errorText =
          err.message?.includes('Failed to fetch')
            ? `エージェントサーバー (${agentUrl}) に接続できませんでした。\nターミナルで \`npm run agent\` が起動しているかご確認ください。`
            : `エラー: ${err.message || '通信に失敗しました'}`;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, text: errorText, isError: true }
              : m
          )
        );
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Ignore if IME composing (Japanese conversion)
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      handleSendMessage();
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
              <span className="font-bold text-xs text-zinc-100">AI壁打ち</span>
              {agentStatus === 'connected' ? (
                <span className="inline-flex items-center space-x-0.5 text-[9px] text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-1 py-0.2 rounded font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-0.5" />
                  Claude Code{agentDetails.isWindows ? ' (Win)' : ''}
                </span>
              ) : agentStatus === 'checking' ? (
                <span className="text-[9px] text-zinc-400 bg-zinc-800 px-1 rounded">確認中...</span>
              ) : (
                <button
                  onClick={checkHealth}
                  className="inline-flex items-center space-x-0.5 text-[9px] text-rose-400 bg-rose-950/80 border border-rose-800/80 px-1 py-0.2 rounded hover:bg-rose-900 transition-colors"
                  title="クリックして再接続確認"
                >
                  <WifiOff className="w-2.5 h-2.5 mr-0.5" />
                  未接続
                </button>
              )}
            </div>
            <span className="text-[10px] text-zinc-400 truncate max-w-[240px]">
              {topicTitle}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          <button
            onClick={handleResetSession}
            disabled={isGenerating}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            title="セッション履歴をリセット"
            aria-label="Reset session"
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

      {/* Connection warning banner if disconnected */}
      {agentStatus === 'disconnected' && (
        <div className="bg-rose-950/80 border-b border-rose-800/80 px-3 py-2 text-rose-300 text-xs flex flex-col space-y-1.5 shrink-0">
          <div className="flex items-center space-x-1.5 font-bold">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
            <span>ローカルAIエージェントが起動していません</span>
          </div>
          <p className="text-[11px] text-rose-200/90 leading-tight">
            Windows の場合は <code className="text-emerald-300 bg-zinc-950 px-1 py-0.5 rounded border border-zinc-800 font-mono">start-agent.bat</code> をダブルクリック、または以下のコマンドで起動してください：
          </p>
          <div className="flex flex-col space-y-1">
            <div className="bg-zinc-950/90 border border-zinc-800 rounded p-1.5 flex items-center justify-between font-mono text-[10px] text-emerald-400">
              <code>start-agent.bat</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText('start-agent.bat');
                  setCopiedId('bat-cmd');
                  setTimeout(() => setCopiedId(null), 2000);
                }}
                className="text-zinc-400 hover:text-zinc-100 p-0.5 ml-2"
                title="コマンドをコピー"
              >
                {copiedId === 'bat-cmd' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
            <div className="bg-zinc-950/90 border border-zinc-800 rounded p-1.5 flex items-center justify-between font-mono text-[10px] text-emerald-400">
              <code>npm run agent</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText('npm run agent');
                  setCopiedId('npm-cmd');
                  setTimeout(() => setCopiedId(null), 2000);
                }}
                className="text-zinc-400 hover:text-zinc-100 p-0.5 ml-2"
                title="コマンドをコピー"
              >
                {copiedId === 'npm-cmd' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Badge & Toggle Bar */}
      {contextFile && (
        <div className="border-b border-zinc-800/80 bg-zinc-900/40 text-xs shrink-0 select-none">
          <div className="px-3 py-1.5 flex items-center justify-between">
            <label className="flex items-center space-x-1.5 cursor-pointer text-zinc-300 hover:text-zinc-100">
              <input
                type="checkbox"
                checked={includeContext}
                onChange={(e) => setIncludeContext(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-0 focus:ring-offset-0"
              />
              <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="text-[11px] font-bold truncate max-w-[200px]">
                {contextFile.name}
              </span>
              <span className="text-[10px] text-zinc-500">
                ({(contextFile.sizeBytes / 1024).toFixed(1)} KB)
              </span>
            </label>

            <button
              onClick={() => setIsContextPreviewOpen((prev) => !prev)}
              className="text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center space-x-0.5 py-0.5 px-1 rounded hover:bg-zinc-800"
            >
              <span>{isContextPreviewOpen ? '隠す' : '中身'}</span>
              {isContextPreviewOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          {/* Context Snippet Preview */}
          {isContextPreviewOpen && (
            <div className="px-3 pb-2 pt-0.5 border-t border-zinc-800/60 bg-zinc-950/80">
              <div className="text-[10px] text-zinc-400 max-h-36 overflow-y-auto whitespace-pre-wrap font-mono p-2 bg-zinc-900/80 rounded border border-zinc-800 select-text">
                {contextFile.content}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 select-text text-xs">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-4 text-zinc-400">
            <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="space-y-1">
              <p className="font-bold text-sm text-zinc-200">Mattermost ログ AI壁打ち</p>
              <p className="text-xs text-zinc-400 max-w-[320px] leading-relaxed">
                直近の会話ログやスレッドの文脈をもとに、要約・課題抽出・返信ドラフトをローカル Claude Code と相談できます。
              </p>
            </div>

            {/* Quick Prompts List */}
            <div className="w-full max-w-[380px] grid grid-cols-2 gap-2 pt-2 text-left">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.id}
                  onClick={() => handleSendMessage(qp.prompt)}
                  disabled={isGenerating}
                  className="p-2 rounded bg-zinc-900 hover:bg-zinc-800/90 border border-zinc-800 hover:border-zinc-700 text-left transition-all group flex flex-col space-y-1"
                >
                  <div className="flex items-center space-x-1.5 font-bold text-zinc-200 group-hover:text-emerald-400 text-xs">
                    <span>{qp.icon}</span>
                    <span>{qp.label}</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 leading-tight">
                    {qp.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col space-y-1 ${
                m.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div className="flex items-center space-x-1.5 text-[10px] text-zinc-500 px-1">
                {m.role === 'user' ? (
                  <span>あなた</span>
                ) : m.role === 'assistant' ? (
                  <span className="flex items-center space-x-1 text-emerald-400 font-bold">
                    <Bot className="w-3 h-3" />
                    <span>Claude Code</span>
                  </span>
                ) : (
                  <span>システム</span>
                )}
                <span>
                  {new Date(m.timestamp).toLocaleTimeString('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>

              <div
                className={`rounded-lg px-3 py-2 text-xs leading-relaxed max-w-[92%] relative group/bubble ${
                  m.role === 'user'
                    ? 'bg-emerald-950/70 border border-emerald-800/80 text-emerald-100 whitespace-pre-wrap'
                    : m.role === 'system'
                    ? 'bg-zinc-900/60 border border-zinc-800 text-zinc-400 italic text-[11px]'
                    : m.isError
                    ? 'bg-rose-950/80 border border-rose-800 text-rose-200 whitespace-pre-wrap'
                    : 'bg-zinc-900 border border-zinc-800 text-zinc-200 whitespace-pre-wrap'
                }`}
              >
                {m.text ? (
                  <div>
                    {m.text}
                    {isGenerating && statusText && m.role === 'assistant' && (
                      <div className="mt-2 text-[10px] text-sky-400 bg-sky-950/40 border border-sky-800/50 rounded px-2 py-1 flex items-center space-x-1.5 animate-pulse font-sans">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                        <span className="truncate">{statusText}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="inline-flex items-center space-x-1 text-zinc-400 italic">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping mr-1 shrink-0" />
                    <span>{statusText || '思考中...'}</span>
                  </span>
                )}

                {/* Assistant actions: Copy / Apply to input */}
                {m.role === 'assistant' && m.text && !m.isError && (
                  <div className="mt-2 pt-1.5 border-t border-zinc-800/80 flex items-center justify-end space-x-2 text-[10px]">
                    <button
                      onClick={() => handleCopy(m.id, m.text)}
                      className="text-zinc-400 hover:text-zinc-200 flex items-center space-x-1 p-0.5 rounded hover:bg-zinc-800 transition-colors"
                      title="テキストをコピー"
                    >
                      {copiedId === m.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">コピー完了</span>
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
                        onClick={() => handleApplyDraft(m.id, m.text)}
                        className="text-sky-400 hover:text-sky-200 flex items-center space-x-1 p-0.5 rounded hover:bg-sky-950/60 transition-colors"
                        title="この文面をMattermostのメッセージ入力欄にセット"
                      >
                        {appliedId === m.id ? (
                          <>
                            <Check className="w-3 h-3 text-sky-400" />
                            <span>入力欄に反映済</span>
                          </>
                        ) : (
                          <>
                            <ArrowRight className="w-3 h-3" />
                            <span>返信欄にセット</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Toolbar (when messages exist) */}
      {messages.length > 0 && (
        <div className="px-3 py-1.5 border-t border-zinc-800/80 bg-zinc-900/30 flex items-center space-x-1.5 overflow-x-auto text-[10px] shrink-0 no-scrollbar">
          <span className="text-zinc-500 shrink-0">クイック:</span>
          {QUICK_PROMPTS.map((qp) => (
            <button
              key={qp.id}
              onClick={() => handleSendMessage(qp.prompt)}
              disabled={isGenerating}
              className="px-2 py-0.5 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 border border-zinc-700/60 shrink-0 transition-colors disabled:opacity-50"
            >
              {qp.icon} {qp.label}
            </button>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="p-3 border-t border-zinc-800 bg-zinc-900/80 shrink-0">
        <div className="relative flex items-end bg-zinc-950 border border-zinc-700 rounded-lg p-1.5 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500/30">
          <textarea
            ref={textareaRef}
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="AIに指示・質問する (Enterで送信、Shift+Enterで改行)..."
            disabled={isGenerating}
            className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 resize-none outline-hidden px-1.5 py-1 min-h-[44px] max-h-[140px] font-mono"
          />

          <div className="flex items-center space-x-1 shrink-0 ml-1">
            {isGenerating ? (
              <button
                type="button"
                onClick={handleStopGeneration}
                className="p-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white transition-colors"
                title="生成を中断"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim()}
                className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:hover:bg-emerald-600 transition-colors"
                title="送信 (Enter)"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-1.5 px-0.5">
          <span>Enter で送信 / Shift+Enter で改行</span>
          <span>CWD: ~/.local-ai-agent/workspaces</span>
        </div>
      </div>
    </div>
  );
};
