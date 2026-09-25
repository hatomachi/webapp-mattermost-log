import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  MattermostChannel,
  MattermostChannelMember,
  MattermostPost,
  MattermostUser,
  MattermostFileInfo,
  MattermostTeam,
  CatchupTabMode,
  ChannelSubscriptionMode,
} from '../types/mattermost';
import {
  getChannelPosts,
  viewChannel,
  formatUserDisplayName,
  formatFileSize,
  getPostReactions,
  getGroupedReactions,
  formatEmojiDisplay,
  buildMattermostChannelUrl,
} from '../services/mattermost';
import { getEffectiveChannelSubscription } from '../services/storage';
import {
  Check,
  CheckCheck,
  ExternalLink,
  Hash,
  Lock,
  User,
  Users,
  RefreshCw,
  Sparkles,
  ArrowLeft,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Loader2,
  AtSign,
  BookOpen,
  Bot,
  Bell,
  BellOff,
} from 'lucide-react';

interface Props {
  serverUrl: string;
  token: string;
  corsProxy?: string;
  channels: MattermostChannel[];
  channelMembers: Record<string, MattermostChannelMember>;
  userCache: Record<string, MattermostUser>;
  resolveMissingUsers: (userIdList: string[]) => Promise<void>;
  fontSize: 'xs' | 'sm' | 'base';
  showSeconds: boolean;
  showTeamBadge: boolean;
  collapseNewlines: boolean;
  showReactions?: boolean;
  onSelectChannel: (channel: MattermostChannel) => void;
  onClose: () => void;
  onChannelMarkedAsRead: (channelId: string) => void;
  onRefreshUnreads: () => Promise<void>;
  teams?: MattermostTeam[];
  webUrl?: string;
  onOpenAiWithUnreads?: (unreadItems: Array<{ channel: MattermostChannel; posts: MattermostPost[]; unreadCount: number }>) => void;
  onOpenAiWithChannelPosts?: (channel: MattermostChannel, posts: MattermostPost[]) => void;
  channelSubscriptions?: Record<string, ChannelSubscriptionMode>;
  onToggleChannelSubscription?: (channelId: string) => void;
}

interface UnreadChannelItem {
  channel: MattermostChannel;
  member: MattermostChannelMember;
  unreadCount: number;
  mentionCount: number;
  isMentionOnly: boolean;
}

interface ChannelCatchupState {
  channel: MattermostChannel;
  member: MattermostChannelMember;
  unreadCount: number;
  mentionCount: number;
  isMentionOnly: boolean;
  posts: MattermostPost[];
  isLoading: boolean;
  isRead: boolean;
  isMarkingRead: boolean;
  error?: string;
}

export const UnreadCatchupViewer: React.FC<Props> = ({
  serverUrl,
  token,
  corsProxy,
  channels,
  channelMembers,
  userCache,
  resolveMissingUsers,
  fontSize,
  showSeconds,
  showTeamBadge,
  collapseNewlines,
  showReactions = false,
  onSelectChannel,
  onClose,
  onChannelMarkedAsRead,
  onRefreshUnreads,
  teams,
  webUrl,
  onOpenAiWithUnreads,
  onOpenAiWithChannelPosts,
  channelSubscriptions = {},
  onToggleChannelSubscription,
}) => {
  const [channelStates, setChannelStates] = useState<Record<string, ChannelCatchupState>>({});
  const [activeTab, setActiveTab] = useState<CatchupTabMode>('main');
  const [isInitializing, setIsInitializing] = useState(true);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [isMarkingMentionOnlyRead, setIsMarkingMentionOnlyRead] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // 関数・プロパティを ref に保持して useEffect の不要な再実行を防ぐ
  const resolveMissingUsersRef = useRef(resolveMissingUsers);
  resolveMissingUsersRef.current = resolveMissingUsers;

  const serverUrlRef = useRef(serverUrl);
  serverUrlRef.current = serverUrl;

  const tokenRef = useRef(token);
  tokenRef.current = token;

  const corsProxyRef = useRef(corsProxy);
  corsProxyRef.current = corsProxy;

  const fontClass = {
    xs: 'text-xs leading-[1.35]',
    sm: 'text-sm leading-snug',
    base: 'text-base leading-normal',
  }[fontSize];

  // 1. 未読があるチャンネルを抽出
  const unreadChannels = useMemo(() => {
    return channels
      .map((ch) => {
        const member = channelMembers[ch.id];
        if (!member) return null;

        const isUnread =
          ch.last_post_at > (member.last_viewed_at || 0) &&
          ch.total_msg_count > (member.msg_count || 0);

        if (!isUnread) return null;

        const unreadCount = Math.max(0, ch.total_msg_count - (member.msg_count || 0));
        const isMentionOnly =
          getEffectiveChannelSubscription(ch.id, member, channelSubscriptions) === 'mention';

        return {
          channel: ch,
          member,
          unreadCount: unreadCount > 0 ? unreadCount : 1,
          mentionCount: member.mention_count || 0,
          isMentionOnly,
        };
      })
      .filter((item): item is UnreadChannelItem => item !== null)
      .sort((a, b) => {
        // メンションがあるものを最優先、次に最新更新順
        if (a.mentionCount !== b.mentionCount) {
          return b.mentionCount - a.mentionCount;
        }
        return b.channel.last_post_at - a.channel.last_post_at;
      });
  }, [channels, channelMembers, channelSubscriptions]);

  // unreadChannels を ref で保持
  const unreadChannelsRef = useRef<UnreadChannelItem[]>(unreadChannels);
  unreadChannelsRef.current = unreadChannels;

  // 2. 初回マウント時および refreshKey 変更時のみ投稿データ取得を実行
  useEffect(() => {
    let isCancelled = false;
    const currentUnreads = unreadChannelsRef.current;

    const initAndFetchPosts = async () => {
      setIsInitializing(true);

      const initialStates: Record<string, ChannelCatchupState> = {};
      currentUnreads.forEach(({ channel, member, unreadCount, mentionCount, isMentionOnly }: UnreadChannelItem) => {
        initialStates[channel.id] = {
          channel,
          member,
          unreadCount,
          mentionCount,
          isMentionOnly,
          posts: [],
          isLoading: true,
          isRead: false,
          isMarkingRead: false,
        };
      });

      setChannelStates(initialStates);

      // 各未読チャンネルの投稿をフェッチ
      const fetchChannel = async (item: UnreadChannelItem) => {
        const { channel, member } = item;
        try {
          const since = member.last_viewed_at > 0 ? member.last_viewed_at : undefined;
          const fetchLimit = Math.min(Math.max(item.unreadCount + 5, 20), 60);

          const res = await getChannelPosts(
            serverUrlRef.current,
            tokenRef.current,
            channel.id,
            0,
            fetchLimit,
            undefined,
            corsProxyRef.current,
            since
          );

          let postList = res.order.map((id) => res.posts[id]).filter(Boolean);

          // 万一 since 以降が0件だった場合、最新ログをフォールバック取得
          if (postList.length === 0) {
            const fallbackRes = await getChannelPosts(
              serverUrlRef.current,
              tokenRef.current,
              channel.id,
              0,
              Math.min(item.unreadCount || 5, 20),
              undefined,
              corsProxyRef.current
            );
            postList = fallbackRes.order.map((id) => fallbackRes.posts[id]).filter(Boolean);
          }

          // 古い順にソート (上から下へ時系列で読めるように)
          postList.sort((a, b) => a.create_at - b.create_at);

          if (!isCancelled) {
            setChannelStates((prev) => {
              if (!prev[channel.id]) return prev;
              return {
                ...prev,
                [channel.id]: {
                  ...prev[channel.id],
                  posts: postList,
                  isLoading: false,
                },
              };
            });

            // ユーザー名解決
            await resolveMissingUsersRef.current(postList.map((p) => p.user_id));
          }
        } catch (err: any) {
          if (!isCancelled) {
            setChannelStates((prev) => {
              if (!prev[channel.id]) return prev;
              return {
                ...prev,
                [channel.id]: {
                  ...prev[channel.id],
                  isLoading: false,
                  error: err.message || '投稿の取得に失敗しました',
                },
              };
            });
          }
        }
      };

      // 5チャンネルずつバッチ実行
      const chunkSize = 5;
      for (let i = 0; i < currentUnreads.length; i += chunkSize) {
        if (isCancelled) break;
        const chunk = currentUnreads.slice(i, i + chunkSize);
        await Promise.all(chunk.map((item: UnreadChannelItem) => fetchChannel(item)));
      }

      if (!isCancelled) {
        setIsInitializing(false);
      }
    };

    if (currentUnreads.length > 0) {
      initAndFetchPosts();
    } else {
      setIsInitializing(false);
      setChannelStates({});
    }

    return () => {
      isCancelled = true;
    };
  }, [refreshKey]);

  // 3. 単一チャンネルの既読化
  const handleMarkAsRead = async (channelId: string) => {
    setChannelStates((prev) => {
      if (!prev[channelId]) return prev;
      return {
        ...prev,
        [channelId]: {
          ...prev[channelId],
          isMarkingRead: true,
        },
      };
    });

    try {
      await viewChannel(serverUrl, token, channelId, '', corsProxy);
      onChannelMarkedAsRead(channelId);

      setChannelStates((prev) => {
        if (!prev[channelId]) return prev;
        return {
          ...prev,
          [channelId]: {
            ...prev[channelId],
            isRead: true,
            isMarkingRead: false,
          },
        };
      });
    } catch (err: any) {
      alert(`既読化に失敗しました: ${err.message}`);
      setChannelStates((prev) => {
        if (!prev[channelId]) return prev;
        return {
          ...prev,
          [channelId]: {
            ...prev[channelId],
            isMarkingRead: false,
          },
        };
      });
    }
  };

  // channelSubscriptions が変更されたら channelStates の isMentionOnly も動的同期
  useEffect(() => {
    setChannelStates((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((id) => {
        const item = next[id];
        const currentIsMention =
          getEffectiveChannelSubscription(item.channel.id, item.member, channelSubscriptions) === 'mention';
        if (item.isMentionOnly !== currentIsMention) {
          next[id] = { ...item, isMentionOnly: currentIsMention };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [channelSubscriptions]);

  // まだ既読になっていない全未読チャンネル
  const activeChannelListAll = useMemo(() => {
    return Object.values(channelStates).filter((s) => !s.isRead);
  }, [channelStates]);

  // メイン未読リスト: 「通常チャンネル」または「メンションのみ設定だがメンションがあるチャンネル」
  const mainUnreadList = useMemo(() => {
    return activeChannelListAll.filter((s) => !s.isMentionOnly || s.mentionCount > 0);
  }, [activeChannelListAll]);

  // メンションのみ（低優先）リスト: 「メンションのみ設定かつメンションがないチャンネル」
  const mentionOnlyUnreadList = useMemo(() => {
    return activeChannelListAll.filter((s) => s.isMentionOnly && s.mentionCount === 0);
  }, [activeChannelListAll]);

  // 現在のタブに応じた表示チャンネルリスト
  const displayedChannelList = useMemo(() => {
    if (activeTab === 'main') return mainUnreadList;
    if (activeTab === 'mention_only') return mentionOnlyUnreadList;
    return activeChannelListAll;
  }, [activeTab, mainUnreadList, mentionOnlyUnreadList, activeChannelListAll]);

  const totalRemainingUnreads = useMemo(() => {
    return displayedChannelList.reduce((acc, cur) => acc + (cur.unreadCount || 1), 0);
  }, [displayedChannelList]);

  // 4. 現在表示中タブの未読を一括既読化
  const handleMarkAllAsRead = async () => {
    const targets = displayedChannelList;
    if (targets.length === 0) return;

    const tabLabel =
      activeTab === 'main'
        ? 'メイン未読'
        : activeTab === 'mention_only'
        ? 'メンションのみ（低優先）'
        : 'すべての未読';

    if (!window.confirm(`${tabLabel} ${targets.length} チャンネルをすべて既読にしますか？`)) {
      return;
    }

    setIsMarkingAllRead(true);
    try {
      await Promise.all(
        targets.map(async (s) => {
          try {
            await viewChannel(serverUrl, token, s.channel.id, '', corsProxy);
            onChannelMarkedAsRead(s.channel.id);
          } catch (e) {
            console.warn(`Failed to mark channel ${s.channel.id} as read:`, e);
          }
        })
      );

      setChannelStates((prev) => {
        const next = { ...prev };
        targets.forEach((s) => {
          if (next[s.channel.id]) {
            next[s.channel.id] = { ...next[s.channel.id], isRead: true };
          }
        });
        return next;
      });
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  // 5. メンションのみ（低優先）未読チャンネルのみを一括既読化（メインタブからの一発一掃ボタン）
  const handleMarkMentionOnlyAsRead = async () => {
    const targets = mentionOnlyUnreadList;
    if (targets.length === 0) return;

    if (!window.confirm(`「メンションのみ追う」設定の未読 ${targets.length} チャンネルをすべて既読にしますか？`)) {
      return;
    }

    setIsMarkingMentionOnlyRead(true);
    try {
      await Promise.all(
        targets.map(async (s) => {
          try {
            await viewChannel(serverUrl, token, s.channel.id, '', corsProxy);
            onChannelMarkedAsRead(s.channel.id);
          } catch (e) {
            console.warn(`Failed to mark mention-only channel ${s.channel.id} as read:`, e);
          }
        })
      );

      setChannelStates((prev) => {
        const next = { ...prev };
        targets.forEach((s) => {
          if (next[s.channel.id]) {
            next[s.channel.id] = { ...next[s.channel.id], isRead: true };
          }
        });
        return next;
      });
    } finally {
      setIsMarkingMentionOnlyRead(false);
    }
  };

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    if (!showSeconds) return `${h}:${m}`;
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
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

  const renderFormattedText = (text: string) => {
    if (!text) return null;
    const formatted = collapseNewlines ? text.replace(/\r?\n+/g, ' ') : text;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = formatted.split(urlRegex);

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
      return <span key={index}>{part}</span>;
    });
  };

  const renderAttachments = (post: MattermostPost) => {
    const files = post.metadata?.files || [];
    if (files.length === 0 && (!post.file_ids || post.file_ids.length === 0)) {
      return null;
    }

    return (
      <div className="flex flex-wrap gap-1.5 mt-0.5 select-none">
        {files.length > 0 ? (
          files.map((file: MattermostFileInfo) => {
            const isImg =
              file.mime_type?.startsWith('image/') ||
              ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes((file.extension || '').toLowerCase());
            return (
              <span
                key={file.id}
                className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-700/80 text-[10px] text-zinc-300 font-mono"
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
                  <span className="text-zinc-500 text-[9px]">({formatFileSize(file.size)})</span>
                )}
              </span>
            );
          })
        ) : (
          <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400">
            <Paperclip className="w-2.5 h-2.5 text-zinc-400" />
            <span>添付ファイル {post.file_ids?.length} 件</span>
          </span>
        )}
      </div>
    );
  };

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

  const getChannelIcon = (type: string) => {
    switch (type) {
      case 'P':
        return <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case 'D':
        return <User className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
      case 'G':
        return <Users className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
      default:
        return <Hash className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
    }
  };

  const handleManualRefresh = async () => {
    setIsInitializing(true);
    try {
      await onRefreshUnreads();
    } finally {
      setRefreshKey((k) => k + 1);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 font-mono overflow-hidden">
      {/* Top Action Bar */}
      <div className="h-10 bg-zinc-900/90 border-b border-zinc-800 px-3 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center space-x-2">
          <button
            onClick={onClose}
            className="flex items-center space-x-1 text-xs text-zinc-400 hover:text-zinc-100 px-1.5 py-1 rounded hover:bg-zinc-800 transition-colors"
            title="ログ閲覧ビューに戻る"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">戻る</span>
          </button>

          <div className="h-4 w-px bg-zinc-700 mx-1" />

          <div className="flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-bold text-xs text-zinc-100">未読キャッチアップ</span>
            <span className="text-[10px] bg-emerald-950 border border-emerald-800 text-emerald-300 px-1.5 py-0.2 rounded-full font-bold">
              {displayedChannelList.length} ch / {totalRemainingUnreads} 件
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleManualRefresh}
            disabled={isInitializing}
            className="flex items-center space-x-1 text-[11px] text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="未読チャンネルを再検索"
          >
            <RefreshCw className={`w-3 h-3 ${isInitializing ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">再検出</span>
          </button>

          {onOpenAiWithUnreads && displayedChannelList.length > 0 && (
            <button
              onClick={() => {
                const items = displayedChannelList.map((s) => ({
                  channel: s.channel,
                  posts: s.posts,
                  unreadCount: s.unreadCount,
                }));
                onOpenAiWithUnreads(items);
              }}
              className="flex items-center space-x-1 text-[11px] bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/70 px-2.5 py-1 rounded transition-colors shadow-sm"
              title="表示中の未読チャンネルをまとめてAIに要約・相談"
            >
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
              <span>AI未読まとめ</span>
            </button>
          )}

          {displayedChannelList.length > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              disabled={isMarkingAllRead}
              className="flex items-center space-x-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 px-2.5 py-1 rounded transition-colors disabled:opacity-50"
              title={`${activeTab === 'main' ? 'メイン未読' : activeTab === 'mention_only' ? 'メンションのみ未読' : 'すべての未読'}を既読にする`}
            >
              {isMarkingAllRead ? (
                <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
              ) : (
                <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>{activeTab === 'main' ? 'メインをすべて既読' : activeTab === 'mention_only' ? '低優先をすべて既読' : 'すべて既読'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub Header: Catchup Tabs & Quick Mute Actions */}
      <div className="h-9 bg-zinc-900/60 border-b border-zinc-800/80 px-3 flex items-center justify-between shrink-0 select-none text-xs">
        {/* Tabs */}
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setActiveTab('main')}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold flex items-center space-x-1.5 transition-colors border ${
              activeTab === 'main'
                ? 'bg-emerald-950/90 border-emerald-700/80 text-emerald-300 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <span>メイン未読</span>
            <span
              className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold ${
                mainUnreadList.length > 0
                  ? 'bg-emerald-800 text-white'
                  : 'bg-zinc-800 text-zinc-500'
              }`}
            >
              {mainUnreadList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('mention_only')}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold flex items-center space-x-1.5 transition-colors border ${
              activeTab === 'mention_only'
                ? 'bg-amber-950/90 border-amber-700/80 text-amber-300 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <BellOff className="w-3 h-3 text-amber-400" />
            <span>メンションのみ</span>
            <span
              className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold ${
                mentionOnlyUnreadList.length > 0
                  ? 'bg-amber-800 text-amber-100'
                  : 'bg-zinc-800 text-zinc-500'
              }`}
            >
              {mentionOnlyUnreadList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('all')}
            className={`hidden sm:flex px-2 py-0.5 rounded text-[11px] font-semibold items-center space-x-1.5 transition-colors border ${
              activeTab === 'all'
                ? 'bg-zinc-800 border-zinc-700 text-zinc-100 font-bold'
                : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            <span>すべて</span>
            <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1.5 py-0.2 rounded-full">
              {activeChannelListAll.length}
            </span>
          </button>
        </div>

        {/* Quick Action: メインタブ表示時に低優先未読を一発全既読にするボタン */}
        {activeTab === 'main' && mentionOnlyUnreadList.length > 0 && (
          <button
            onClick={handleMarkMentionOnlyAsRead}
            disabled={isMarkingMentionOnlyRead}
            className="flex items-center space-x-1 text-[10px] sm:text-[11px] text-amber-400/90 hover:text-amber-300 bg-amber-950/40 hover:bg-amber-950/80 border border-amber-800/60 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
            title="「メンションのみ追う」設定のチャンネルをすべて一発で既読にします"
          >
            {isMarkingMentionOnlyRead ? (
              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
            ) : (
              <BellOff className="w-3 h-3 text-amber-400" />
            )}
            <span>低優先({mentionOnlyUnreadList.length})を一括既読</span>
          </button>
        )}
      </div>

      {/* Main Scroll Content */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-4">
        {isInitializing && displayedChannelList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400 space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
            <p className="text-xs">未読チャンネルと投稿を読み込み中...</p>
          </div>
        ) : displayedChannelList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-3 px-4">
            <div className="w-12 h-12 rounded-full bg-emerald-950/60 border border-emerald-700/60 flex items-center justify-center text-emerald-400 shadow-lg">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-zinc-200">
                {activeTab === 'main'
                  ? 'メインの未読メッセージはありません！'
                  : activeTab === 'mention_only'
                  ? 'メンション待ちの未読はありません'
                  : 'すべての未読を読み終えました！'}
              </p>
              <p className="text-xs text-zinc-500 mt-1 max-w-sm">
                {activeTab === 'main' && mentionOnlyUnreadList.length > 0
                  ? `「メンション以外は追わない」設定の未読が ${mentionOnlyUnreadList.length} チャンネルあります。別タブで確認するか、一括既読にできます。`
                  : '現在、このタブに未読メッセージはありません。'}
              </p>
            </div>

            {activeTab === 'main' && mentionOnlyUnreadList.length > 0 ? (
              <div className="flex items-center space-x-2 mt-2">
                <button
                  onClick={() => setActiveTab('mention_only')}
                  className="bg-amber-950/80 hover:bg-amber-900 border border-amber-700/80 text-amber-300 text-xs px-3 py-1.5 rounded transition-colors flex items-center space-x-1"
                >
                  <BellOff className="w-3.5 h-3.5" />
                  <span>メンションのみ ({mentionOnlyUnreadList.length}) を確認</span>
                </button>
                <button
                  onClick={handleMarkMentionOnlyAsRead}
                  disabled={isMarkingMentionOnlyRead}
                  className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs px-3 py-1.5 rounded transition-colors"
                >
                  一括既読にする
                </button>
              </div>
            ) : (
              <button
                onClick={onClose}
                className="mt-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-1.5 rounded shadow transition-colors"
              >
                通常ログ閲覧に戻る
              </button>
            )}
          </div>
        ) : (
          displayedChannelList.map((state) => {
            const { channel, posts, isLoading, isMarkingRead, unreadCount, mentionCount, error } =
              state;
            const mmUrl = buildMattermostChannelUrl(serverUrl, channel, teams, webUrl);

            return (
              <div
                key={channel.id}
                className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden shadow-lg transition-all"
              >
                {/* Channel Header (Sticky) */}
                <div className="bg-zinc-900 px-3 py-2 border-b border-zinc-800 flex items-center justify-between sticky top-0 z-10">
                  <div className="flex items-center space-x-2 min-w-0">
                    {getChannelIcon(channel.type)}

                    {showTeamBadge && channel.team_display_name && (
                      <span className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.2 rounded shrink-0 max-w-[90px] truncate border border-zinc-700">
                        {channel.team_display_name}
                      </span>
                    )}

                    {mmUrl ? (
                      <a
                        href={mmUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-xs text-zinc-100 hover:text-emerald-400 truncate flex items-center space-x-1 group/title"
                        title={`Mattermostで開く (${mmUrl})`}
                      >
                        <span className="truncate group-hover/title:underline underline-offset-2">
                          {channel.display_name || channel.name}
                        </span>
                        <ExternalLink className="w-2.5 h-2.5 opacity-60 group-hover/title:opacity-100 shrink-0" />
                      </a>
                    ) : (
                      <span className="font-bold text-xs text-zinc-100 truncate">
                        {channel.display_name || channel.name}
                      </span>
                    )}

                    {/* Unread badge */}
                    <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.2 rounded border border-zinc-700 shrink-0">
                      {unreadCount} 件未読
                    </span>

                    {/* Mention badge */}
                    {mentionCount > 0 && (
                      <span className="flex items-center space-x-0.5 text-[10px] bg-rose-950 border border-rose-700 text-rose-300 px-1.5 py-0.2 rounded shrink-0 font-bold">
                        <AtSign className="w-2.5 h-2.5 text-rose-400" />
                        <span>{mentionCount}</span>
                      </span>
                    )}

                    {/* Low priority badge */}
                    {state.isMentionOnly && (
                      <span className="flex items-center space-x-0.5 text-[10px] bg-amber-950/80 border border-amber-800 text-amber-300 px-1.5 py-0.2 rounded shrink-0 font-semibold">
                        <BellOff className="w-2.5 h-2.5 text-amber-400" />
                        <span className="hidden sm:inline">低優先</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    {onToggleChannelSubscription && (
                      <button
                        onClick={() => onToggleChannelSubscription(channel.id)}
                        className={`text-[11px] p-1 rounded flex items-center space-x-1 border transition-colors ${
                          state.isMentionOnly
                            ? 'bg-amber-950/70 border-amber-700/80 text-amber-300 hover:bg-amber-900'
                            : 'bg-zinc-800/80 border-zinc-700/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                        }`}
                        title={
                          state.isMentionOnly
                            ? '現在「メンションのみ追う」設定（クリックで通常追うに変更）'
                            : '現在「通常追う」設定（クリックでメンションのみ追うに変更）'
                        }
                      >
                        {state.isMentionOnly ? (
                          <>
                            <BellOff className="w-3 h-3 text-amber-400" />
                            <span className="hidden md:inline">メンションのみ</span>
                          </>
                        ) : (
                          <>
                            <Bell className="w-3 h-3 text-zinc-400" />
                            <span className="hidden md:inline">通常</span>
                          </>
                        )}
                      </button>
                    )}

                    {onOpenAiWithChannelPosts && posts.length > 0 && (
                      <button
                        onClick={() => onOpenAiWithChannelPosts(channel, posts)}
                        className="text-zinc-400 hover:text-emerald-300 p-1 hover:bg-zinc-800 rounded text-[11px] flex items-center space-x-1"
                        title="このチャンネルの未読をAIに添付して相談"
                      >
                        <Bot className="w-3 h-3 text-emerald-400" />
                        <span className="hidden sm:inline">AI相談</span>
                      </button>
                    )}

                    <button
                      onClick={() => onSelectChannel(channel)}
                      className="text-zinc-400 hover:text-zinc-200 p-1 hover:bg-zinc-800 rounded text-[11px] flex items-center space-x-1"
                      title="このチャンネルをログビューで開く"
                    >
                      <BookOpen className="w-3 h-3 text-sky-400" />
                      <span className="hidden sm:inline">開く</span>
                    </button>

                    {mmUrl && (
                      <a
                        href={mmUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-400 hover:text-emerald-400 p-1 hover:bg-zinc-800 rounded text-[11px] flex items-center space-x-1"
                        title="Mattermostで開く"
                      >
                        <ExternalLink className="w-3 h-3 text-emerald-400" />
                        <span className="hidden sm:inline">Mattermost</span>
                      </a>
                    )}

                    <button
                      onClick={() => handleMarkAsRead(channel.id)}
                      disabled={isMarkingRead}
                      className="flex items-center space-x-1 text-[11px] bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                      title="このチャンネルを既読にする"
                    >
                      {isMarkingRead ? (
                        <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                      ) : (
                        <Check className="w-3 h-3 text-emerald-400" />
                      )}
                      <span>既読</span>
                    </button>
                  </div>
                </div>

                {/* Posts Content */}
                <div className="p-2 sm:p-3 divide-y divide-zinc-800/40">
                  {isLoading ? (
                    <div className="py-6 flex items-center justify-center space-x-2 text-zinc-500 text-xs">
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                      <span>投稿を取得中...</span>
                    </div>
                  ) : error ? (
                    <div className="py-4 text-center text-xs text-rose-400">{error}</div>
                  ) : posts.length === 0 ? (
                    <div className="py-4 text-center text-xs text-zinc-500 italic">
                      未読メッセージはありません
                    </div>
                  ) : (
                    posts.map((post) => {
                      const user = userCache[post.user_id];
                      const displayName = formatUserDisplayName(
                        user,
                        post.props?.override_username
                      );
                      const userColor = getUserColor(post.user_id, displayName);

                      return (
                        <div
                          key={post.id}
                          className={`py-1 hover:bg-zinc-800/30 px-1 rounded transition-colors ${fontClass}`}
                        >
                          <div className="flex items-baseline space-x-2">
                            {/* Timestamp */}
                            <span className="text-zinc-500 select-none shrink-0 font-mono text-[10px]">
                              [{formatTime(post.create_at)}]
                            </span>

                            {/* Author */}
                            <span
                              className={`font-semibold shrink-0 select-none max-w-[120px] sm:max-w-[160px] truncate ${userColor}`}
                              title={displayName}
                            >
                              {displayName}:
                            </span>

                            {/* Message */}
                            <div className="flex-1 text-zinc-200 break-words whitespace-pre-wrap select-text">
                              {renderFormattedText(post.message)}
                              {renderReactions(post)}
                              {renderAttachments(post)}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Channel Footer Mark-As-Read Action */}
                <div className="p-2.5 bg-zinc-900/60 border-t border-zinc-800 flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500">
                    ここまで読み終えたら既読にできます
                  </span>

                  <button
                    onClick={() => handleMarkAsRead(channel.id)}
                    disabled={isMarkingRead}
                    className="flex items-center space-x-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-3 py-1.5 rounded shadow shadow-emerald-950 transition-colors disabled:opacity-50"
                  >
                    {isMarkingRead ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>このチャンネルを既読にする</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
