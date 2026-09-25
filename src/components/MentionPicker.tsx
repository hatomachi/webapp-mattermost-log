import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AtSign, Search, X, Loader2, RefreshCw, Users, User, Radio } from 'lucide-react';
import { MattermostUser } from '../types/mattermost';
import { formatUserDisplayName } from '../services/mattermost';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectMention: (mention: string) => void;
  channelUsers: MattermostUser[];
  isLoading: boolean;
  error?: string | null;
  onRefresh?: () => void;
  channelName?: string;
}

interface SpecialMention {
  name: string;
  description: string;
  icon: 'channel' | 'here' | 'all';
}

const SPECIAL_MENTIONS: SpecialMention[] = [
  { name: 'channel', description: 'チャンネルの全員に通知', icon: 'channel' },
  { name: 'here', description: 'オンライン中のメンバーに通知', icon: 'here' },
  { name: 'all', description: '全員に通知', icon: 'all' },
];

export const MentionPicker: React.FC<Props> = ({
  isOpen,
  onClose,
  onSelectMention,
  channelUsers,
  isLoading,
  error,
  onRefresh,
  channelName,
}) => {
  const [query, setQuery] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ポップオーバーが開いたときに検索窓にフォーカス
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // 外側クリックとEscキーで閉じる
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // 検索フィルター
  const filteredSpecials = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    if (!q) return SPECIAL_MENTIONS;
    return SPECIAL_MENTIONS.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }, [query]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    if (!q) return channelUsers;
    return channelUsers.filter((u) => {
      const username = (u.username || '').toLowerCase();
      const displayName = formatUserDisplayName(u).toLowerCase();
      const first = (u.first_name || '').toLowerCase();
      const last = (u.last_name || '').toLowerCase();
      const nick = (u.nickname || '').toLowerCase();
      return (
        username.includes(q) ||
        displayName.includes(q) ||
        first.includes(q) ||
        last.includes(q) ||
        nick.includes(q)
      );
    });
  }, [query, channelUsers]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full mb-2 left-1.5 sm:left-2 z-30 w-80 max-w-[calc(100vw-20px)] bg-zinc-900/95 backdrop-blur-md border border-zinc-700/80 rounded-lg shadow-2xl flex flex-col overflow-hidden text-zinc-200 select-none animate-in fade-in zoom-in-95 duration-100"
      style={{ maxHeight: '380px' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-950/60 shrink-0">
        <div className="flex items-center space-x-1.5 text-xs font-semibold text-zinc-300">
          <AtSign className="w-3.5 h-3.5 text-emerald-400" />
          <span>メンション先を選択</span>
          {channelName && (
            <span className="text-zinc-500 font-normal truncate max-w-[110px] text-[10px]">
              (#{channelName})
            </span>
          )}
        </div>
        <div className="flex items-center space-x-1">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors disabled:opacity-40"
              title="メンバー一覧を再取得"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            title="閉じる (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 検索入力欄 */}
      <div className="p-2 border-b border-zinc-800/80 shrink-0">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前や @ID で絞り込み..."
            className="w-full bg-zinc-950 border border-zinc-700/60 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 rounded py-1 pl-7 pr-6 text-xs text-zinc-200 placeholder-zinc-500 font-mono outline-hidden select-text"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 text-zinc-500 hover:text-zinc-300 text-xs"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* リスト部分 */}
      <div className="flex-1 overflow-y-auto min-h-[140px] max-h-[280px] divide-y divide-zinc-800/40 text-xs font-mono">
        {/* ローディング表示 */}
        {isLoading && channelUsers.length === 0 && (
          <div className="flex flex-col items-center justify-center p-6 text-zinc-500 space-y-2">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
            <span className="text-[11px]">メンバー一覧を読み込み中...</span>
          </div>
        )}

        {/* エラー表示 */}
        {!isLoading && error && channelUsers.length === 0 && (
          <div className="p-4 text-center text-rose-400 text-xs space-y-2">
            <p>{error}</p>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] transition-colors"
              >
                再試行
              </button>
            )}
          </div>
        )}

        {/* 特殊メンション */}
        {filteredSpecials.length > 0 && (
          <div className="py-1">
            <div className="px-2.5 py-1 text-[10px] text-zinc-500 font-sans uppercase font-bold tracking-wider">
              一斉通知
            </div>
            {filteredSpecials.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => onSelectMention(s.name)}
                className="w-full text-left px-2.5 py-1.5 flex items-center space-x-2 hover:bg-emerald-950/40 hover:text-emerald-300 transition-colors group cursor-pointer"
              >
                <div className="w-5 h-5 rounded-full bg-emerald-900/60 border border-emerald-700/50 flex items-center justify-center text-emerald-400 shrink-0">
                  {s.icon === 'here' ? (
                    <Radio className="w-2.5 h-2.5" />
                  ) : (
                    <Users className="w-2.5 h-2.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-emerald-400 group-hover:text-emerald-300">
                    @{s.name}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate font-sans">
                    {s.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* チャンネルメンバー */}
        {filteredUsers.length > 0 && (
          <div className="py-1">
            <div className="px-2.5 py-1 text-[10px] text-zinc-500 font-sans uppercase font-bold tracking-wider flex justify-between items-center">
              <span>メンバー ({filteredUsers.length})</span>
            </div>
            {filteredUsers.map((u) => {
              const displayName = formatUserDisplayName(u);
              const initial = (displayName || u.username || '?').charAt(0).toUpperCase();

              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onSelectMention(u.username)}
                  className="w-full text-left px-2.5 py-1.5 flex items-center space-x-2 hover:bg-zinc-800/80 transition-colors group cursor-pointer"
                >
                  <div className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] text-zinc-300 shrink-0 font-sans font-bold">
                    {initial || <User className="w-2.5 h-2.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-1.5">
                      <span className="font-semibold text-zinc-200 truncate group-hover:text-white font-sans text-xs">
                        {displayName}
                      </span>
                      <span className="text-[10px] text-zinc-500 truncate group-hover:text-zinc-400">
                        @{u.username}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ヒットなし */}
        {!isLoading &&
          filteredSpecials.length === 0 &&
          filteredUsers.length === 0 && (
            <div className="p-6 text-center text-zinc-500 text-xs">
              該当するメンバーが見つかりません
            </div>
          )}
      </div>

      {/* フッターヒント */}
      <div className="px-3 py-1.5 bg-zinc-950/80 border-t border-zinc-800 text-[10px] text-zinc-500 flex items-center justify-between shrink-0 font-sans">
        <span>クリックで入力欄に挿入</span>
        <span className="text-zinc-600">Escで閉じる</span>
      </div>
    </div>
  );
};
