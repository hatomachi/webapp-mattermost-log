import React, { useEffect, useRef, useState, useMemo } from 'react';
import { MattermostPost, MattermostUser, MattermostFileInfo, ReplyTarget } from '../types/mattermost';
import {
  formatUserDisplayName,
  formatFileSize,
  getPostReactions,
  getGroupedReactions,
  formatEmojiDisplay,
} from '../services/mattermost';
import { EmojiPicker } from './EmojiPicker';
import { MentionPicker } from './MentionPicker';
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
  Send,
  Reply,
  Bot,
  Check,
  Bell,
  BellOff,
  AtSign,
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
  channelId?: string;
  channelName?: string;
  channelUsers?: MattermostUser[];
  onFetchChannelUsers?: (channelId: string) => Promise<MattermostUser[]>;
  hasMorePosts?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlderPosts?: () => Promise<void>;
  threadPosts?: Record<string, MattermostPost[]>;
  loadingThreads?: Record<string, boolean>;
  onFetchThread?: (postId: string) => Promise<void>;
  onSendPost?: (message: string, rootId?: string) => Promise<boolean>;
  onOpenAiWithThread?: (rootPost: MattermostPost) => void;
  onOpenAiWithChannel?: () => void;
  appliedDraft?: string | null;
  onClearAppliedDraft?: () => void;
  isUnread?: boolean;
  unreadCount?: number;
  onMarkAsRead?: () => void;
  isMarkingRead?: boolean;
  isMentionOnly?: boolean;
  onToggleChannelSubscription?: () => void;
  currentUserId?: string;
  favoriteEmojis?: string[];
  recentEmojis?: string[];
  onToggleReaction?: (postId: string, emojiName: string) => Promise<void>;
  onAddReaction?: (postId: string, emojiName: string) => Promise<void>;
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
  channelId,
  channelName,
  channelUsers: channelUsersProp,
  onFetchChannelUsers,
  hasMorePosts = false,
  isLoadingOlder = false,
  onLoadOlderPosts,
  threadPosts = {},
  loadingThreads = {},
  onFetchThread,
  onSendPost,
  onOpenAiWithThread,
  onOpenAiWithChannel,
  appliedDraft,
  onClearAppliedDraft,
  isUnread = false,
  unreadCount = 0,
  onMarkAsRead,
  isMarkingRead = false,
  isMentionOnly = false,
  onToggleChannelSubscription,
  currentUserId,
  favoriteEmojis,
  recentEmojis,
  onToggleReaction,
  onAddReaction,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isFilterMode, setIsFilterMode] = useState(false); // true: マッチ行のみ表示, false: ハイライトのみ
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [pickerPostId, setPickerPostId] = useState<string | null>(null);

  // メンションピッカーステート
  const [isMentionPickerOpen, setIsMentionPickerOpen] = useState(false);
  const [loadedChannelUsers, setLoadedChannelUsers] = useState<MattermostUser[]>([]);
  const [isLoadingChannelUsers, setIsLoadingChannelUsers] = useState(false);
  const [channelUsersError, setChannelUsersError] = useState<string | null>(null);

  // 投稿・返信ステート
  const [inputText, setInputText] = useState('');
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Handle draft text injected from AI chat drawer
  useEffect(() => {
    if (appliedDraft) {
      setInputText(appliedDraft);
      onClearAppliedDraft?.();
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [appliedDraft, onClearAppliedDraft]);

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

  // チャンネル変更時に最下部へスクロール & 検索・入力初期化
  useEffect(() => {
    scrollToBottom(false);
    setExpandedThreads({});
    setReplyTarget(null);
    setInputText('');
    setSendError(null);
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

  // 入力欄の高さ自動調整
  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  // チャンネル変更時にメンションピッカーをリセット
  useEffect(() => {
    setIsMentionPickerOpen(false);
    setLoadedChannelUsers([]);
    setChannelUsersError(null);
  }, [channelId]);

  // 返信ターゲットを設定
  const handleSetReply = (target: MattermostPost) => {
    const rootId = target.root_id || target.id;
    const user = userCache[target.user_id];
    const authorName = formatUserDisplayName(user, target.props?.override_username);
    const messagePreview = (target.message || '').replace(/\r?\n+/g, ' ').slice(0, 60);

    setReplyTarget({
      rootId,
      postId: target.id,
      authorName,
      messagePreview: messagePreview || '(メッセージなし)',
      createAt: target.create_at,
    });
    setSendError(null);

    // スレッドが展開されていない場合は展開
    if (!expandedThreads[rootId] && onFetchThread) {
      toggleThread(rootId);
    }

    // 返信相手へのメンションを自動挿入（相手が自分自身でない場合）
    const targetUsername = user?.username || target.props?.override_username;
    if (targetUsername && target.user_id !== currentUserId) {
      const mentionText = `@${targetUsername} `;
      setInputText((prev) => {
        // すでに先頭にメンションが入っているか、または同一メンションが含まれていればそのまま
        if (prev.startsWith(mentionText) || prev.includes(`@${targetUsername}`)) {
          return prev;
        }
        return `${mentionText}${prev}`;
      });
    }

    setTimeout(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
      }
      adjustTextareaHeight();
    }, 50);
  };

  // 返信をキャンセル
  const handleCancelReply = () => {
    if (replyTarget) {
      // もし入力欄が返信相手へのメンションのみ（例: "@tanaka "）なら入力欄もクリア
      const user = Object.values(userCache).find(
        (u) => formatUserDisplayName(u) === replyTarget.authorName || u.username === replyTarget.authorName
      );
      const targetUsername = user?.username;
      if (targetUsername && (inputText.trim() === `@${targetUsername}` || inputText === `@${targetUsername} `)) {
        setInputText('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }
    }
    setReplyTarget(null);
  };

  // メンションピッカーのトグル & チャンネルメンバー読み込み
  const handleToggleMentionPicker = async () => {
    if (isMentionPickerOpen) {
      setIsMentionPickerOpen(false);
      return;
    }

    setIsMentionPickerOpen(true);

    const hasMembers = (channelUsersProp && channelUsersProp.length > 0) || loadedChannelUsers.length > 0;
    if (channelId && onFetchChannelUsers && !hasMembers) {
      try {
        setIsLoadingChannelUsers(true);
        setChannelUsersError(null);
        const users = await onFetchChannelUsers(channelId);
        setLoadedChannelUsers(users);
      } catch (err: any) {
        setChannelUsersError(err.message || 'メンバーの取得に失敗しました');
      } finally {
        setIsLoadingChannelUsers(false);
      }
    }
  };

  // チャンネルメンバーの再取得
  const handleRefreshChannelUsers = async () => {
    if (!channelId || !onFetchChannelUsers) return;
    try {
      setIsLoadingChannelUsers(true);
      setChannelUsersError(null);
      const users = await onFetchChannelUsers(channelId);
      setLoadedChannelUsers(users);
    } catch (err: any) {
      setChannelUsersError(err.message || 'メンバーの取得に失敗しました');
    } finally {
      setIsLoadingChannelUsers(false);
    }
  };

  // メンション選択
  const handleSelectMention = (mentionName: string) => {
    const mentionText = `@${mentionName} `;
    const textarea = textareaRef.current;
    if (!textarea) {
      setInputText((prev) => (prev ? `${prev} ${mentionText}` : mentionText));
      setIsMentionPickerOpen(false);
      return;
    }

    const start = textarea.selectionStart ?? inputText.length;
    const end = textarea.selectionEnd ?? inputText.length;
    const before = inputText.substring(0, start);
    const after = inputText.substring(end);
    const nextText = `${before}${mentionText}${after}`;
    setInputText(nextText);
    setIsMentionPickerOpen(false);

    setTimeout(() => {
      textarea.focus();
      const newCursor = start + mentionText.length;
      textarea.setSelectionRange(newCursor, newCursor);
      adjustTextareaHeight();
    }, 10);
  };

  // 表示用メンバーリスト
  const currentChannelUsers = useMemo(() => {
    if (channelUsersProp && channelUsersProp.length > 0) {
      return channelUsersProp;
    }
    return loadedChannelUsers;
  }, [channelUsersProp, loadedChannelUsers]);

  // 投稿・返信送信
  const handleSubmit = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isSending || !onSendPost) return;

    setIsSending(true);
    setSendError(null);

    try {
      const isReply = Boolean(replyTarget);
      await onSendPost(trimmed, replyTarget?.rootId);
      setInputText('');
      setReplyTarget(null);

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      // 新規親投稿の場合は最下部へスクロール
      if (!isReply) {
        setTimeout(() => {
          scrollToBottom(true);
        }, 100);
      }
    } catch (err: any) {
      setSendError(err.message || '送信に失敗しました');
    } finally {
      setIsSending(false);
    }
  };

  // キー入力ハンドラ (Enterで送信, Shift+Enterで改行, Escで返信キャンセル/ピッカー閉じる)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME入力中は無視
    if (e.nativeEvent.isComposing || e.key === 'Process' || e.keyCode === 229) {
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      if (isMentionPickerOpen) {
        e.preventDefault();
        setIsMentionPickerOpen(false);
      } else if (replyTarget) {
        e.preventDefault();
        handleCancelReply();
      }
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

  // スタンプ（リアクション）描画（行を増やさないインライン表示、クリックで被せ・解除）
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
          const hasReacted = Boolean(currentUserId && r.users.includes(currentUserId));
          const userNames = r.users
            .map((uid) => {
              const u = userCache[uid];
              return formatUserDisplayName(u);
            })
            .filter(Boolean)
            .join(', ');
          const tooltip = `:${r.name}: (${r.count})${userNames ? `\n${userNames}` : ''}\n${
            hasReacted ? 'クリックでスタンプ解除' : 'クリックでスタンプを被せる'
          }`;

          return (
            <button
              key={r.name}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleReaction?.(post.id, r.name);
              }}
              title={tooltip}
              className={`inline-flex items-center space-x-0.5 px-1 py-0 rounded border text-[10px] leading-tight font-mono transition-colors cursor-pointer select-none ${
                hasReacted
                  ? 'bg-sky-950/80 border-sky-500/80 text-sky-200 hover:border-sky-400 font-semibold ring-1 ring-sky-500/30'
                  : isUnicode
                  ? 'bg-zinc-900/90 border-zinc-700/80 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800'
              }`}
            >
              <span className={isUnicode ? 'text-xs -my-0.5' : 'text-[10px]'}>{display}</span>
              <span className={`text-[9px] font-semibold ${hasReacted ? 'text-sky-300' : 'text-zinc-400'}`}>
                {r.count}
              </span>
            </button>
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

          {onToggleChannelSubscription && (
            <button
              onClick={onToggleChannelSubscription}
              className={`flex items-center space-x-1 px-2 py-1 rounded text-[11px] border transition-colors shrink-0 ${
                isMentionOnly
                  ? 'bg-amber-950/80 border-amber-600 text-amber-300 font-bold'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
              title={
                isMentionOnly
                  ? 'メンションのみ追う設定中（クリックで通常追うに変更）'
                  : '通常追う設定中（クリックでメンションのみ追うに変更）'
              }
            >
              {isMentionOnly ? (
                <>
                  <BellOff className="w-3 h-3 text-amber-400" />
                  <span className="hidden sm:inline">メンションのみ</span>
                  <span className="sm:hidden">低優先</span>
                </>
              ) : (
                <>
                  <Bell className="w-3 h-3 text-zinc-400" />
                  <span className="hidden sm:inline">通常</span>
                  <span className="sm:hidden">通常</span>
                </>
              )}
            </button>
          )}
        </div>

        <div className="flex items-center space-x-1.5 shrink-0 ml-2">
          {searchQuery && (
            <span className="text-[10px] text-zinc-400">
              一致: {displayedPosts.length} 件
            </span>
          )}

          {onMarkAsRead && (
            <button
              onClick={onMarkAsRead}
              disabled={isMarkingRead}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] border font-sans transition-colors shrink-0 disabled:opacity-50 cursor-pointer ${
                isUnread
                  ? 'bg-emerald-950/90 hover:bg-emerald-900 border-emerald-600/80 text-emerald-300 font-bold shadow-xs'
                  : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700/80 text-zinc-400 hover:text-zinc-200'
              }`}
              title={
                isUnread
                  ? `このチャンネルを既読にする（未読 ${unreadCount || 0} 件）`
                  : 'このチャンネルを既読にする（既読状態を更新）'
              }
            >
              {isMarkingRead ? (
                <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
              ) : (
                <Check className={`w-3 h-3 ${isUnread ? 'text-emerald-400' : 'text-zinc-500'}`} />
              )}
              <span>既読</span>
              {isUnread && (unreadCount || 0) > 0 && (
                <span className="text-[9px] bg-emerald-800 text-white px-1 py-0.1 rounded-full font-mono">
                  {unreadCount}
                </span>
              )}
            </button>
          )}

          {onOpenAiWithChannel && (
            <button
              onClick={onOpenAiWithChannel}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/80 text-emerald-300 font-sans transition-colors"
              title="このチャンネルのログをもとにAI壁打ちを開く"
            >
              <Bot className="w-3 h-3 text-emerald-400" />
              <span className="hidden md:inline">AI相談</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Log Scroll Area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto px-2.5 py-2 select-text ${fontClass}`}
      >
        {/* Empty state notice */}
        {chronologicalPosts.length === 0 && !isLoading && (
          <div className="py-12 flex flex-col items-center justify-center text-zinc-500 font-mono text-center select-none">
            <p className="text-xs text-zinc-400 mb-1">メッセージはまだありません</p>
            <p className="text-[10px] text-zinc-600">下の入力欄からメッセージを投稿できます</p>
          </div>
        )}

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
          const isReplyTarget = replyTarget?.postId === post.id;

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

              <div
                className={`group py-0.5 px-1 rounded flex flex-col transition-colors ${
                  isReplyTarget
                    ? 'bg-sky-950/40 ring-1 ring-sky-500/40'
                    : 'hover:bg-zinc-900/60'
                }`}
              >
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

                            {onSendPost && !isSystemMessage && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSetReply(post);
                                }}
                                className={`inline-flex items-center space-x-0.5 ml-1.5 text-[10px] px-1 py-0.2 rounded text-zinc-500 hover:text-sky-300 hover:bg-sky-950/40 select-none align-baseline cursor-pointer transition-opacity ${
                                  isReplyTarget
                                    ? 'text-sky-400 bg-sky-950/50'
                                    : 'opacity-50 sm:opacity-0 sm:group-hover:opacity-100'
                                }`}
                                title="この投稿に返信"
                              >
                                <Reply className="w-2.5 h-2.5" />
                                <span className="text-[9px]">返信</span>
                              </button>
                            )}

                            {onAddReaction && !isSystemMessage && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPickerPostId(post.id);
                                }}
                                className="inline-flex items-center space-x-0.5 ml-1 text-[10px] px-1 py-0.2 rounded text-zinc-500 hover:text-amber-300 hover:bg-amber-950/40 select-none align-baseline cursor-pointer transition-opacity opacity-50 sm:opacity-0 sm:group-hover:opacity-100"
                                title="スタンプを押す"
                              >
                                <Smile className="w-2.5 h-2.5" />
                                <span className="text-[9px]">スタンプ</span>
                              </button>
                            )}

                            {onOpenAiWithThread && !isSystemMessage && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenAiWithThread(post);
                                }}
                                className="inline-flex items-center space-x-0.5 ml-1 text-[10px] px-1 py-0.2 rounded text-zinc-500 hover:text-emerald-300 hover:bg-emerald-950/40 select-none align-baseline cursor-pointer transition-opacity opacity-50 sm:opacity-0 sm:group-hover:opacity-100"
                                title="この投稿・スレッドについてAIに相談"
                              >
                                <Bot className="w-2.5 h-2.5 text-emerald-400" />
                                <span className="text-[9px] text-emerald-300">AI</span>
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
                          const isReplyTargetReply = replyTarget?.postId === reply.id;

                          return (
                            <div
                              key={reply.id}
                              className={`group flex items-start space-x-1.5 py-0.5 rounded px-1 transition-colors ${
                                isReplyTargetReply
                                  ? 'bg-sky-950/50 ring-1 ring-sky-500/40'
                                  : 'hover:bg-zinc-900/70'
                              }`}
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
                                {onSendPost && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSetReply(reply);
                                    }}
                                    className={`inline-flex items-center space-x-0.5 ml-1.5 text-[10px] px-1 py-0.2 rounded text-zinc-500 hover:text-sky-300 hover:bg-sky-950/40 select-none align-baseline cursor-pointer transition-opacity ${
                                      isReplyTargetReply
                                        ? 'text-sky-400 bg-sky-950/50'
                                        : 'opacity-50 sm:opacity-0 sm:group-hover:opacity-100'
                                    }`}
                                    title="このスレッドに返信"
                                  >
                                    <Reply className="w-2.5 h-2.5" />
                                    <span className="text-[9px]">返信</span>
                                  </button>
                                )}
                                {onAddReaction && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPickerPostId(reply.id);
                                    }}
                                    className="inline-flex items-center space-x-0.5 ml-1 text-[10px] px-1 py-0.2 rounded text-zinc-500 hover:text-amber-300 hover:bg-amber-950/40 select-none align-baseline cursor-pointer transition-opacity opacity-50 sm:opacity-0 sm:group-hover:opacity-100"
                                    title="スタンプを押す"
                                  >
                                    <Smile className="w-2.5 h-2.5" />
                                    <span className="text-[9px]">スタンプ</span>
                                  </button>
                                )}
                                {onOpenAiWithThread && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenAiWithThread(post);
                                    }}
                                    className="inline-flex items-center space-x-0.5 ml-1 text-[10px] px-1 py-0.2 rounded text-zinc-500 hover:text-emerald-300 hover:bg-emerald-950/40 select-none align-baseline cursor-pointer transition-opacity opacity-50 sm:opacity-0 sm:group-hover:opacity-100"
                                    title="このスレッドについてAIに相談"
                                  >
                                    <Bot className="w-2.5 h-2.5 text-emerald-400" />
                                    <span className="text-[9px] text-emerald-300">AI</span>
                                  </button>
                                )}
                                {renderAttachments(reply)}
                              </div>
                            </div>
                          );
                        })
                    )}

                    {onSendPost && currentThreadPosts.length > 0 && (
                      <div className="pt-0.5 select-none">
                        <button
                          type="button"
                          onClick={() => handleSetReply(post)}
                          className="text-[10px] text-sky-400 hover:text-sky-300 inline-flex items-center space-x-1 py-0.5 px-1.5 rounded hover:bg-sky-950/50 transition-colors"
                        >
                          <Reply className="w-2.5 h-2.5" />
                          <span>このスレッドに返信</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* チャンネル未読フッターバー（未読がある時、読み終えた位置で既読化できるバー） */}
      {isUnread && onMarkAsRead && (
        <div className="shrink-0 px-3 py-1.5 bg-zinc-900/95 border-t border-zinc-800/80 flex items-center justify-between text-xs select-none">
          <div className="flex items-center space-x-1.5 text-zinc-400 text-[11px]">
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>
              ここまで読み終えたら既読にできます
              {(unreadCount || 0) > 0 ? ` (未読 ${unreadCount} 件)` : ''}
            </span>
          </div>
          <button
            onClick={onMarkAsRead}
            disabled={isMarkingRead}
            className="flex items-center space-x-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-2.5 py-1 rounded shadow shadow-emerald-950 transition-colors disabled:opacity-50 cursor-pointer"
            title="このチャンネルを既読にする"
          >
            {isMarkingRead ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>このチャンネルを既読にする</span>
          </button>
        </div>
      )}

      {/* Floating Scroll to Bottom Button */}
      {showScrollBottom && (
        <button
          onClick={() => scrollToBottom(true)}
          className={`absolute ${
            isUnread && onMarkAsRead
              ? onSendPost
                ? 'bottom-28'
                : 'bottom-14'
              : onSendPost
              ? 'bottom-16'
              : 'bottom-3'
          } right-3 p-2 bg-emerald-600/90 hover:bg-emerald-500 text-white rounded-full shadow-lg border border-emerald-400/30 transition-all flex items-center justify-center backdrop-blur-xs select-none z-10`}
          title="最新のログへ移動"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* Bottom Input Area (控えめな投稿・返信欄) */}
      {onSendPost && (
        <div className="shrink-0 border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur-xs select-none">
          {/* 返信先インジケータ */}
          {replyTarget && (
            <div className="flex items-center justify-between px-2.5 py-1 bg-sky-950/50 border-b border-sky-800/40 text-[11px] text-sky-300">
              <div className="flex items-center space-x-1.5 min-w-0">
                <Reply className="w-3 h-3 text-sky-400 shrink-0" />
                <span className="font-semibold text-sky-200 shrink-0">
                  返信先: @{replyTarget.authorName}
                </span>
                <span className="text-sky-400/70 truncate text-[10px]">
                  "{replyTarget.messagePreview}"
                </span>
              </div>
              <button
                type="button"
                onClick={handleCancelReply}
                className="text-sky-400 hover:text-sky-100 ml-2 px-1.5 py-0.5 rounded hover:bg-sky-900/60 flex items-center text-[10px] shrink-0 transition-colors"
                title="返信をキャンセル (Esc)"
              >
                <X className="w-3 h-3" />
                <span className="ml-0.5 hidden sm:inline">取消 (Esc)</span>
              </button>
            </div>
          )}

          {/* 入力行 */}
          <div className="p-1.5 sm:px-2.5 flex items-end space-x-1.5 relative">
            {/* プロンプトラベル */}
            <div className="shrink-0 pb-1 text-zinc-500 font-mono text-[11px] hidden sm:flex items-center select-none">
              <span className="text-emerald-500/80 font-bold mr-1">
                {replyTarget ? '↩' : '>'}
              </span>
              <span className="max-w-[130px] truncate text-zinc-400">
                {replyTarget ? `スレッド返信` : `#${channelName}`}
              </span>
            </div>

            {/* メンション挿入ボタン */}
            <button
              type="button"
              onClick={handleToggleMentionPicker}
              className={`shrink-0 p-1.5 mb-0.5 rounded font-mono text-xs transition-colors flex items-center justify-center min-w-[28px] h-[28px] border cursor-pointer ${
                isMentionPickerOpen
                  ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/60 shadow-xs'
                  : 'bg-zinc-900/90 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-zinc-700/80'
              }`}
              title="メンションを挿入 (@)"
            >
              <AtSign className="w-3.5 h-3.5" />
            </button>

            {/* メンションピッカー */}
            <MentionPicker
              isOpen={isMentionPickerOpen}
              onClose={() => setIsMentionPickerOpen(false)}
              onSelectMention={handleSelectMention}
              channelUsers={currentChannelUsers}
              isLoading={isLoadingChannelUsers}
              error={channelUsersError}
              onRefresh={handleRefreshChannelUsers}
              channelName={channelName}
            />

            {/* 自動伸縮テキストエリア */}
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  adjustTextareaHeight();
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  replyTarget
                    ? `@${replyTarget.authorName} への返信を入力... (Enterで送信, Shift+Enterで改行)`
                    : `#${channelName} への投稿を入力... (Enterで送信, Shift+Enterで改行)`
                }
                disabled={isSending}
                className="w-full bg-zinc-900/90 border border-zinc-700/80 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 rounded px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-500 font-mono resize-none leading-relaxed min-h-[30px] max-h-[120px] transition-all disabled:opacity-50 select-text"
              />
            </div>

            {/* 送信ボタン */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!inputText.trim() || isSending}
              className="shrink-0 p-1.5 mb-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-mono text-xs transition-colors disabled:opacity-30 disabled:hover:bg-emerald-600 flex items-center justify-center min-w-[28px] h-[28px]"
              title={replyTarget ? '返信を送信 (Enter)' : '投稿を送信 (Enter)'}
            >
              {isSending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* エラー表示 */}
          {sendError && (
            <div className="px-2.5 pb-1 text-[10px] text-rose-400 flex items-center justify-between">
              <span>{sendError}</span>
              <button onClick={() => setSendError(null)} className="hover:text-rose-200">×</button>
            </div>
          )}
        </div>
      )}

      {/* スタンプ（リアクション）ピッカー */}
      <EmojiPicker
        isOpen={Boolean(pickerPostId)}
        onClose={() => setPickerPostId(null)}
        onSelectEmoji={(emojiName) => {
          if (pickerPostId) {
            onAddReaction?.(pickerPostId, emojiName);
          }
        }}
        favoriteEmojis={favoriteEmojis}
        recentEmojis={recentEmojis}
      />
    </div>
  );
};

