import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Copy, Check, Search, AlertCircle } from 'lucide-react';
import { ContextAttachment } from '../../features/ai/aiRemoteTypes';

interface Props {
  isOpen: boolean;
  attachment: ContextAttachment | null;
  onClose: () => void;
}

export const ContextAttachmentModal: React.FC<Props> = ({
  isOpen,
  attachment,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  // Reset states on open/attachment change
  useEffect(() => {
    if (isOpen) {
      setCopied(false);
      setSearchQuery('');
    }
  }, [isOpen, attachment?.id]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const rawContent = attachment?.contentMarkdown || '';

  // Stats
  const stats = useMemo(() => {
    const chars = rawContent.length;
    const lines = rawContent ? rawContent.split('\n').length : 0;
    // Rough token estimation for Japanese / mixed text (~3 characters per token)
    const estimatedTokens = Math.ceil(chars / 3);
    return { chars, lines, estimatedTokens };
  }, [rawContent]);

  // Search match count
  const matchCount = useMemo(() => {
    if (!searchQuery.trim() || !rawContent) return 0;
    const q = searchQuery.toLowerCase();
    let count = 0;
    let pos = 0;
    const lower = rawContent.toLowerCase();
    while ((pos = lower.indexOf(q, pos)) !== -1) {
      count++;
      pos += q.length;
    }
    return count;
  }, [rawContent, searchQuery]);

  const handleCopy = async () => {
    if (!rawContent) return;
    try {
      await navigator.clipboard.writeText(rawContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy', e);
    }
  };

  if (!isOpen || !attachment) return null;

  // Render content with search highlight
  const renderHighlightedContent = () => {
    if (!searchQuery.trim()) {
      return (
        <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-zinc-300 select-text">
          {rawContent}
        </pre>
      );
    }

    const q = searchQuery.toLowerCase();
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    const lower = rawContent.toLowerCase();
    let idx = lower.indexOf(q, lastIndex);
    let key = 0;

    while (idx !== -1) {
      if (idx > lastIndex) {
        parts.push(rawContent.slice(lastIndex, idx));
      }
      parts.push(
        <mark
          key={key++}
          className="bg-amber-400 text-zinc-950 font-bold px-0.5 rounded"
        >
          {rawContent.slice(idx, idx + q.length)}
        </mark>
      );
      lastIndex = idx + q.length;
      idx = lower.indexOf(q, lastIndex);
    }

    if (lastIndex < rawContent.length) {
      parts.push(rawContent.slice(lastIndex));
    }

    return (
      <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-zinc-300 select-text">
        {parts}
      </pre>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-3.5 sm:p-4 border-b border-zinc-800/90 bg-zinc-900/80 flex items-center justify-between shrink-0">
          <div className="min-w-0 flex-1 pr-3">
            <div className="flex items-center space-x-2">
              <span className="text-base">📎</span>
              <h3 className="font-bold text-sm sm:text-base text-zinc-100 truncate">
                {attachment.title}
              </h3>
              {attachment.badge && (
                <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800/70 px-1.5 py-0.5 rounded font-mono shrink-0">
                  {attachment.badge}
                </span>
              )}
            </div>
            {attachment.subtitle && (
              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                {attachment.subtitle}
              </p>
            )}
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center space-x-1.5 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className={`inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                copied
                  ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
                  : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-200 hover:text-white'
              }`}
              title="添付テキスト全文をクリップボードにコピー"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>コピー完了</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>全文コピー</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="閉じる (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar: Stats & Search */}
        <div className="px-3.5 py-2 border-b border-zinc-800/70 bg-zinc-900/40 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400 shrink-0">
          {/* Metadata badges */}
          <div className="flex items-center space-x-3 font-mono">
            <span>文字数: <strong className="text-zinc-200">{stats.chars.toLocaleString()}</strong></span>
            <span>行数: <strong className="text-zinc-200">{stats.lines}</strong></span>
            <span>推定トークン: <strong className="text-emerald-400">~{stats.estimatedTokens.toLocaleString()}</strong></span>
          </div>

          {/* Quick Filter / Search */}
          <div className="flex items-center space-x-1.5 bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 w-full sm:w-64 focus-within:border-emerald-500 transition-colors">
            <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ログ内を検索..."
              className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 outline-none"
            />
            {searchQuery && (
              <div className="flex items-center space-x-1 shrink-0">
                <span className="text-[10px] text-zinc-400 font-mono">
                  {matchCount}件
                </span>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-zinc-400 hover:text-zinc-200"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto p-4 bg-zinc-950/90 text-zinc-200 font-mono"
        >
          {renderHighlightedContent()}
        </div>

        {/* Footer Notice */}
        <div className="px-4 py-2 border-t border-zinc-800/80 bg-zinc-900/80 flex items-center justify-between text-[11px] text-zinc-400 shrink-0">
          <div className="flex items-center space-x-1.5 text-zinc-400 truncate mr-2">
            <AlertCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">
              このテキストが AI への質問送信時にプロンプト先頭へ自動埋め込まれます
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs transition-colors shrink-0"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
