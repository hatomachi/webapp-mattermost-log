import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Clock, Star } from 'lucide-react';
import { formatEmojiDisplay } from '../services/mattermost';
import { DEFAULT_FAVORITE_EMOJIS } from '../services/storage';

interface EmojiPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEmoji: (emojiName: string) => void;
  favoriteEmojis?: string[];
  recentEmojis?: string[];
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  isOpen,
  onClose,
  onSelectEmoji,
  favoriteEmojis = DEFAULT_FAVORITE_EMOJIS,
  recentEmojis = [],
}) => {
  const [customInput, setCustomInput] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Escキーで閉じる
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 開いた時に入力欄リセット
  useEffect(() => {
    if (isOpen) {
      setCustomInput('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelect = (emojiName: string) => {
    const clean = emojiName.trim().replace(/^:+|:+$/g, '');
    if (clean) {
      onSelectEmoji(clean);
      onClose();
    }
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    handleSelect(customInput.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-[1px] animate-in fade-in duration-100"
      onClick={onClose}
    >
      <div
        ref={pickerRef}
        className="w-full max-w-xs bg-zinc-900 border border-zinc-700/80 rounded-lg shadow-2xl overflow-hidden font-mono text-xs flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-950/70">
          <span className="font-semibold text-zinc-200 flex items-center space-x-1.5">
            <span>😊</span>
            <span>スタンプを選択</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 overflow-y-auto space-y-3.5 flex-1 select-none">
          {/* 直近使ったスタンプ */}
          {recentEmojis.length > 0 && (
            <div>
              <div className="flex items-center space-x-1 text-[10px] text-zinc-400 font-semibold mb-1.5">
                <Clock className="w-3 h-3 text-zinc-500" />
                <span>最近使用</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recentEmojis.map((emojiName) => {
                  const { display, isUnicode } = formatEmojiDisplay(emojiName);
                  return (
                    <button
                      key={`recent-${emojiName}`}
                      type="button"
                      onClick={() => handleSelect(emojiName)}
                      title={`:${emojiName}:`}
                      className={`inline-flex items-center justify-center rounded px-2 py-1 border transition-all cursor-pointer ${
                        isUnicode
                          ? 'bg-zinc-800/90 border-zinc-700 text-zinc-100 hover:bg-zinc-700 hover:border-zinc-500 text-base'
                          : 'bg-zinc-800 border-zinc-700 text-sky-300 hover:bg-zinc-700 hover:border-zinc-500 text-[11px]'
                      }`}
                    >
                      {display}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 定番・お気に入りスタンプ */}
          <div>
            <div className="flex items-center space-x-1 text-[10px] text-zinc-400 font-semibold mb-1.5">
              <Star className="w-3 h-3 text-amber-500/80" />
              <span>お気に入り / 定番</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {favoriteEmojis.map((emojiName) => {
                const { display, isUnicode } = formatEmojiDisplay(emojiName);
                return (
                  <button
                    key={`fav-${emojiName}`}
                    type="button"
                    onClick={() => handleSelect(emojiName)}
                    title={`:${emojiName}:`}
                    className={`flex items-center justify-center rounded py-1.5 px-1 border transition-all cursor-pointer ${
                      isUnicode
                        ? 'bg-zinc-800/70 border-zinc-700/80 text-zinc-100 hover:bg-zinc-700 hover:border-zinc-500 text-lg'
                        : 'bg-zinc-800/70 border-zinc-700/80 text-sky-300 hover:bg-zinc-700 hover:border-zinc-500 text-[10px] truncate max-w-full'
                    }`}
                  >
                    <span className="truncate">{display}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* カスタム絵文字・名前直接入力 */}
          <div className="pt-1 border-t border-zinc-800/80">
            <div className="text-[10px] text-zinc-400 font-semibold mb-1.5">
              <span>カスタム名入力 (例: otsukare, shochi)</span>
            </div>
            <form onSubmit={handleCustomSubmit} className="flex items-center space-x-1.5">
              <input
                ref={inputRef}
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder=":stamp_name: または名前"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-sky-500 font-mono"
              />
              <button
                type="submit"
                disabled={!customInput.trim()}
                className="bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:hover:bg-sky-600 text-white px-2.5 py-1 rounded flex items-center justify-center transition-colors cursor-pointer"
                title="送信"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
