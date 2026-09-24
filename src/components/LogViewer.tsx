import React, { useEffect, useRef, useState, useMemo } from 'react';
import { MattermostPost, MattermostUser, MattermostFileInfo } from '../types/mattermost';
import {
  formatUserDisplayName,
  formatFileSize,
  getPostReactions,
  getGroupedReactions,
  formatEmojiDisplay,
} from '../services/mattermost';
import {
  ArrowDown,
  CornerDownRight,
  Search,
  X,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Loader2,
  Filter,
  WrapText,
  Smile,
} from 'lucide-react';

interface Props {
  posts: MattermostPost[];
  userCache: Record<string, MattermostUser>;
  showSeconds: boolean;
  fontSize: 'xs' | 'sm' | 'base';
  isLoading: boolean;
  collapseNewlines?: boolean;
  onToggleCollapseNewlines?: () => void;
  showReactions?: boolean;
  onToggleShowReactions?: () => void;
  channelName?: string;
  hasMorePosts?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlderPosts?: () => Promise<void>;
  threadPosts?: Record<string, MattermostPost[]>;
  loadingThreads?: Record<string, boolean>;
  onFetchThread?: (postId: string) => Promise<void>;
}

export const LogViewer: React.FC<Props> = ({
  posts,
  userCache,
  showSeconds,
  fontSize,
  isLoading,
  collapseNewlines = false,
  onToggleCollapseNewlines,
  showReactions = false,
  onToggleShowReactions,
  channelName,
  hasMorePosts = false,
  isLoadingOlder = false,
  onLoadOlderPosts,
  threadPosts = {},
  loadingThreads = {},
  onFetchThread,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isFilterMode, setIsFilterMode] = useState(false); // true: マッチ行のみ表示, false: ハイライトのみ
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const fontClass = {
    xs: 'text-xs leading-[1.35]',
    sm: 'text-sm leading-snug',
    base: 'text-base leading-normal',
  }[fontSize];

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    if (!showSeconds) return `${h}:${m}`;
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  // 改行無視（高密度表示）時のテキスト成形
  const formatMessageText = (text: string) => {
    if (!text) return '';
    if (!collapseNewlines) return text;
    return text.replace(/\r?\n+/g, ' ');
  };

  const formatDateLabel = (timestamp: number) => {
    const d = new Date(timestamp);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return `${y}/${m}/${day} (${days[d.getDay()]})`;
  };

  const chronologicalPosts = useMemo(() => {
    return [...posts].sort((a, b) => a.create_at - b.create_at);
  }, [posts]);

  // 検索フィルター適用
  const displayedPosts = useMemo(() => {
    if (!isFilterMode || !searchQuery.trim()) {
      return chronologicalPosts;
    }
    const q = searchQuery.toLowerCase();
    return chronologicalPosts.filter((post) => {
      const user = userCache[post.user_id];
      const displayName = formatUserDisplayName(user, post.props?.override_username).toLowerCase();
      const message = (post.message || '').toLowerCase();
      return displayName.includes(q) || message.includes(q);
    });
  }, [chronologicalPosts, isFilterMode, searchQuery, userCache]);

  const scrollToBottom = (smooth = true) => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  };

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShowScrollBottom(!isNearBottom);
  };

  // チャンネル変更時に最下部へスクロール & 検索初期化
  useEffect(() => {
    scrollToBottom(false);
    setExpandedThreads({});
  }, [channelName]);

  // 新着メッセージ受信時に最下部表示中ならスクロール追従
  useEffect(() => {
    if (!showScrollBottom) {
      scrollToBottom(false);
    }
  }, [posts.length]);

  // 過去ログ読み込み処理（スクロール位置を維持）
  const handleLoadOlder = async () => {
    if (!onLoadOlderPosts || isLoadingOlder || !containerRef.current) return;
    const prevScrollHeight = containerRef.current.scrollHeight;
    const prevScrollTop = containerRef.current.scrollTop;

    await onLoadOlderPosts();

    requestAnimationFrame(() => {
      if (containerRef.current) {
        const newScrollHeight = containerRef.current.scrollHeight;
        containerRef.current.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
      }
    });
  };

  const toggleThread = async (postId: string) => {
    const isCurrentlyExpanded = Boolean(expandedThreads[postId]);
    setExpandedThreads((prev) => ({
      ...prev,
      [postId]: !isCurrentlyExpanded,
    }));

    if (!isCurrentlyExpanded && onFetchThread && !threadPosts[postId]) {
      await onFetchThread(postId);
    }
  };

  const getUserColor = (userId: string, name: string) => {
    const colors = [
      'text-emerald-400',
      'text-sky-400',
      'text-amber-400',
      'text-teal-400',
      'text-cyan-400',
      'text-indigo-400',
      'text-rose-400',
      'text-yellow-400',
      'text-lime-400',
      'text-pink-400',
    ];
    let hash = 0;
    const key = userId || name;
    for (let i = 0; i < key.length; i++) {
      hash = (hash << 5) - hash + key.charCodeAt(i);
      hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
  };

  // テキスト内のURLリンク化と検索文字列のハイライト
  const renderFormattedText = (text: string, query: string) => {
    if (!text) return null;

    // URL正規表現
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 hover:text-sky-300 underline underline-offset-2 break-all select-text"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }

      // 検索ハイライト
      if (!query.trim()) {
        return <span key={index}>{part}</span>;
      }

      const lowerPart = part.toLowerCase();
      const lowerQuery = query.toLowerCase();
      const matchIndex = lowerPart.indexOf(lowerQuery);

      if (matchIndex === -1) {
        return <span key={index}>{part}</span>;
      }

      const highlightedNodes: React.ReactNode[] = [];
      let currentIdx = 0;

      while (currentIdx < part.length) {
        const nextMatch = lowerPart.indexOf(lowerQuery, currentIdx);
        if (nextMatch === -1) {
          highlightedNodes.push(part.substring(currentIdx));
          break;
        }
        if (nextMatch > currentIdx) {
          highlightedNodes.push(part.substring(currentIdx, nextMatch));
        }
        highlightedNodes.push(
          <mark
            key={`mark-${currentIdx}`}
            className="bg-amber-400/90 text-zinc-950 font-bold px-0.5 rounded-xs"
          >
            {part.substring(nextMatch, nextMatch + query.length)}
          </mark>
        );
        currentIdx = nextMatch + query.length;
      }

      return <span key={index}>{highlightedNodes}</span>;
    });
  };

  // 添付ファイル描画
  const renderAttachments = (post: MattermostPost) => {
    const files = post.metadata?.files || [];
    if (files.length === 0 && (!post.file_ids || post.file_ids.length === 0)) {
      return null;
    }

    return (
      <div className="flex flex-wrap gap-1.5 mt-1 select-none">
        {files.length > 0 ? (
          files.map((file: MattermostFileInfo) => {
            const isImg = file.mime_type?.startsWith('image/') ||
              ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes((file.extension || '').toLowerCase());
            return (
              <span
                key={file.id}
                className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700/80 text-[10px] text-zinc-300 font-mono"
              >
                {isImg ? (
                  <ImageIcon className="w-3 h-3 text-sky-400 shrink-0" />
                ) : (
                  <FileText className="w-3 h-3 text-amber-400 shrink-0" />
                )}
                <span className="truncate max-w-[140px]" title={file.name}>
                  {file.name}
                </span>
                {file.size > 0 && (
                  <span className="text-zinc-500 text-[9px]">
                    ({formatFileSize(file.size)})
                  </span>
                )}
              </span>
            );
          })
        ) : (
          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400">
            <Paperclip className="w-2.5 h-2.5 text-zinc-400" />
            <span>添付ファイル {post.file_ids?.length} 件</span>
          </span>
        )}
      </div>
    );
  };

  // スタンプ（リアクション）描画（行を増やさないインライン表示）
  const renderReactions = (post: MattermostPost) => {
    if (!showReactions) return null;
    const reactions = getPostReactions(post);
    if (reactions.length === 0) return null;
    const grouped = getGroupedReactions(reactions);
    if (grouped.length === 0) return null;

    return (
      <span className="inline-flex flex-wrap items-center gap-1 ml-1.5 align-baseline select-none">
        {grouped.map((r) => {
          const { display, isUnicode } = formatEmojiDisplay(r.name);
          const userNames = r.users
            .map((uid) => {
              const u = userCache[uid];
              return formatUserDisplayName(u);
            })
            .filter(Boolean)
            .join(', ');
          const tooltip = `:${r.name}: (${r.count})${userNames ? `\n${userNames}` : ''}`;

          return (
            <span
              key={r.name}
              title={tooltip}
              className={`inline-flex items-center space-x-0.5 px-1 py-0 rounded border text-[10px] leading-tight font-mono transition-colors ${
                isUnicode
                  ? 'bg-zinc-900/90 border-zinc-700/80 text-zinc-200 hover:border-zinc-500'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              <span className={isUnicode ? 'text-xs -my-0.5' : 'text-[10px]'}>{display}</span>
              <span className="text-[9px] text-zinc-400 font-semibold">{r.count}</span>
            </span>
          );
        })}
      </span>
    );
  };

  if (!channelName) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-zinc-500 font-mono text-center">
        <p className="text-sm text-zinc-400 mb-1">チャンネルが選択されていません</p>
        <p className="text-xs text-zinc-600">
          左上のメニューアイコンから閲覧したいチャンネルを選択してください
        </p>
      </div>
    );
  }

  if (chronologicalPosts.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-zinc-500 font-mono text-center">
        <p className="text-xs text-zinc-400 mb-1">メッセージはまだありません</p>
        <p className="text-[10px] text-zinc-600">最新ログを受信待機中...</p>
      </div>
    );
  }

  let lastDateStr = '';

  return (
    <div className="relative flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden font-mono">
      {/* Inline Grep / Search Toolbar */}
      <div className="border-b border-zinc-800/80 bg-zinc-900/60 px-2 py-1 flex items-center justify-between text-xs select-none">
        <div className="flex items-center space-x-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2 top-2" />
            <input
              type="text"
              placeholder="ログ内 grep 検索 (キーワード / 送信者)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700/80 rounded pl-7 pr-6 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1.5 text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            onClick={() => setIsFilterMode(!isFilterMode)}
            className={`flex items-center space-x-1 px-2 py-1 rounded text-[11px] border transition-colors shrink-0 ${
              isFilterMode
                ? 'bg-emerald-950 border-emerald-700 text-emerald-300 font-bold'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
            title={isFilterMode ? 'マッチした行のみ表示中（クリックで全件表示+ハイライトへ）' : '全件表示・ハイライト中（クリックでマッチ行のみへ絞り込み）'}
          >
            <Filter className="w-3 h-3" />
            <span className="hidden sm:inline">{isFilterMode ? '絞込' : 'ハイライト'}</span>
            <span className="sm:hidden">{isFilterMode ? '絞込' : '全件'}</span>
          </button>

          {onToggleCollapseNewlines && (
            <button
              onClick={onToggleCollapseNewlines}
              className={`flex items-center space-x-1 px-2 py-1 rounded text-[11px] border transition-colors shrink-0 ${
                collapseNewlines
                  ? 'bg-amber-950/80 border-amber-600 text-amber-300 font-bold'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
              title={
                collapseNewlines
                  ? '改行無視中（クリックで通常の改行表示へ戻す）'
                  : '改行を無視して表示（クリックで1行化・全体俯瞰）'
              }
            >
              <WrapText className="w-3 h-3" />
              <span className="hidden sm:inline">{collapseNewlines ? '改行無視' : '改行あり'}</span>
              <span className="sm:hidden">{collapseNewlines ? '無視' : '改行'}</span>
            </button>
          )}

          {onToggleShowReactions && (
            <button
              onClick={onToggleShowReactions}
              className={`flex items-center space-x-1 px-2 py-1 rounded text-[11px] border transition-colors shrink-0 ${
                showReactions
                  ? 'bg-amber-950/80 border-amber-600 text-amber-300 font-bold'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
              title={
                showReactions
                  ? 'スタンプ表示中（クリックで非表示）'
                  : 'スタンプを表示（クリックで切替）'
              }
            >
              <Smile className="w-3 h-3" />
              <span className="hidden sm:inline">{showReactions ? 'スタンプ' : 'スタンプ無'}</span>
              <span className="sm:hidden">{showReactions ? 'スタンプ' : '絵無'}</span>
            </button>
          )}
        </div>

        {searchQuery && (
          <span className="text-[10px] text-zinc-400 ml-2 shrink-0">
            一致: {displayedPosts.length} 件
          </span>
        )}
      </div>

      {/* Main Log Scroll Area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto px-2.5 py-2 select-text ${fontClass}`}
      >
        {/* Load Older Posts Button */}
        {hasMorePosts && (
          <div className="py-2 text-center select-none">
            <button
              onClick={handleLoadOlder}
              disabled={isLoadingOlder}
              className="inline-flex items-center space-x-1.5 px-3 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded text-xs text-zinc-300 transition-colors disabled:opacity-50"
            >
              {isLoadingOlder ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                  <span>過去ログ読み込み中...</span>
                </>
              ) : (
                <span>↑ 過去のログをさらに読み込む</span>
              )}
            </button>
          </div>
        )}

        {displayedPosts.map((post) => {
          const currentDateStr = formatDateLabel(post.create_at);
          const isNewDate = currentDateStr !== lastDateStr;
          if (isNewDate) {
            lastDateStr = currentDateStr;
          }

          const user = userCache[post.user_id];
          const displayName = formatUserDisplayName(
            user,
            post.props?.override_username
          );
          const userColor = getUserColor(post.user_id, displayName);

          const isSystemMessage = post.type && post.type !== '';
          const replyCount = post.reply_count || 0;
          const isThreadExpanded = Boolean(expandedThreads[post.id]);
          const currentThreadPosts = threadPosts[post.id] || [];
          const isThreadLoading = Boolean(loadingThreads[post.id]);

          return (
            <React.Fragment key={post.id}>
              {isNewDate && (
                <div className="my-2 flex items-center text-zinc-600 text-[10px] select-none">
                  <span className="shrink-0 text-zinc-500 font-semibold">
                    ── {currentDateStr} ──
                  </span>
                  <div className="flex-1 border-t border-zinc-800 ml-2" />
                </div>
              )}

              <div className="group py-0.5 px-1 hover:bg-zinc-900/60 rounded flex flex-col transition-colors">
                <div className="flex items-start space-x-1.5">
                  <span className="text-zinc-600 shrink-0 text-[11px] select-none font-mono tracking-tight">
                    [{formatTime(post.create_at)}]
                  </span>

                  <div
                    className={`flex-1 min-w-0 break-words ${
                      collapseNewlines ? 'whitespace-normal' : 'whitespace-pre-wrap'
                    }`}
                  >
                    {isSystemMessage ? (
                      <span className="text-zinc-500 italic text-[11px]">
                        * {displayName} {formatMessageText(post.message)}
                      </span>
                    ) : (
                      <>
                        <span className={`font-semibold shrink-0 mr-1.5 select-text ${userColor}`}>
                          {displayName}:
                        </span>
                        <span className="text-zinc-200 selection:bg-emerald-950 selection:text-emerald-200">
                          {renderFormattedText(formatMessageText(post.message), searchQuery)}
                        </span>

                        {renderReactions(post)}

                        {replyCount > 0 && (
                          <button
                            onClick={() => toggleThread(post.id)}
                            className={`inline-flex items-center space-x-0.5 ml-2 text-[10px] px-1.5 py-0.2 rounded border select-none align-baseline cursor-pointer transition-colors ${
                              isThreadExpanded
                                ? 'bg-sky-950/80 border-sky-700 text-sky-300 font-bold'
                                : 'bg-zinc-800/80 hover:bg-zinc-800 text-sky-400 border-zinc-700'
                            }`}
                          >
                            <CornerDownRight className="w-2.5 h-2.5" />
                            <span>
                              {isThreadExpanded ? '返信を閉じる' : `返信 ${replyCount} 件`}
                            </span>
                          </button>
                        )}

                        {renderAttachments(post)}
                      </>
                    )}
                  </div>
                </div>

                {/* Inline Thread View */}
                {isThreadExpanded && (
                  <div className="mt-1 ml-6 pl-3 border-l-2 border-sky-800/60 bg-zinc-900/40 rounded-r py-1 pr-2 space-y-1">
                    {isThreadLoading && currentThreadPosts.length === 0 ? (
                      <div className="flex items-center space-x-1.5 text-zinc-500 text-[11px] py-0.5">
                        <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
                        <span>スレッド返信を取得中...</span>
                      </div>
                    ) : currentThreadPosts.length === 0 ? (
                      <div className="text-zinc-500 text-[11px] py-0.5 italic">
                        返信はありません
                      </div>
                    ) : (
                      currentThreadPosts
                        .filter((reply) => reply.id !== post.id) // 親メッセージは除外
                        .sort((a, b) => a.create_at - b.create_at)
                        .map((reply) => {
                          const replyUser = userCache[reply.user_id];
                          const replyDisplayName = formatUserDisplayName(
                            replyUser,
                            reply.props?.override_username
                          );
                          const replyColor = getUserColor(reply.user_id, replyDisplayName);

                          return (
                            <div
                              key={reply.id}
                              className="flex items-start space-x-1.5 py-0.5 hover:bg-zinc-900/70 rounded px-1"
                            >
                              <span className="text-sky-500/70 select-none shrink-0 text-[11px]">
                                └──
                              </span>
                              <span className="text-zinc-600 shrink-0 text-[11px] select-none font-mono tracking-tight">
                                [{formatTime(reply.create_at)}]
                              </span>
                              <div
                                className={`flex-1 min-w-0 break-words ${
                                  collapseNewlines ? 'whitespace-normal' : 'whitespace-pre-wrap'
                                }`}
                              >
                                <span className={`font-semibold shrink-0 mr-1.5 select-text ${replyColor}`}>
                                  {replyDisplayName}:
                                </span>
                                <span className="text-zinc-200">
                                  {renderFormattedText(formatMessageText(reply.message), searchQuery)}
                                </span>
                                {renderReactions(reply)}
                                {renderAttachments(reply)}
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {showScrollBottom && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-3 right-3 p-2 bg-emerald-600/90 hover:bg-emerald-500 text-white rounded-full shadow-lg border border-emerald-400/30 transition-all flex items-center justify-center backdrop-blur-xs select-none"
          title="最新のログへ移動"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

