import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MattermostChannel,
  MattermostChannelMember,
  MattermostPost,
  MattermostUser,
  MattermostFileInfo,
} from '../types/mattermost';
import {
  getChannelPosts,
  viewChannel,
  formatUserDisplayName,
  formatFileSize,
} from '../services/mattermost';
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
  onSelectChannel: (channel: MattermostChannel) => void;
  onClose: () => void;
  onChannelMarkedAsRead: (channelId: string) => void;
  onRefreshUnreads: () => Promise<void>;
}

interface ChannelCatchupState {
  channel: MattermostChannel;
  member: MattermostChannelMember;
  unreadCount: number;
  mentionCount: number;
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
  onSelectChannel,
  onClose,
  onChannelMarkedAsRead,
  onRefreshUnreads,
}) => {
  const [channelStates, setChannelStates] = useState<Record<string, ChannelCatchupState>>({});
  const [isInitializing, setIsInitializing] = useState(true);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

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
        return {
          channel: ch,
          member,
          unreadCount: unreadCount > 0 ? unreadCount : 1,
          mentionCount: member.mention_count || 0,
        };
      })
      .filter((item): item is {
        channel: MattermostChannel;
        member: MattermostChannelMember;
        unreadCount: number;
        mentionCount: number;
      } => item !== null)
      .sort((a, b) => {
        // メンションがあるものを最優先、次に最新更新順
        if (a.mentionCount !== b.mentionCount) {
          return b.mentionCount - a.mentionCount;
        }
        return b.channel.last_post_at - a.channel.last_post_at;
      });
  }, [channels, channelMembers]);

  // 2. 未読チャンネルの初期化と投稿データ取得
  useEffect(() => {
    let isCancelled = false;

    const initAndFetchPosts = async () => {
      setIsInitializing(true);

      const initialStates: Record<string, ChannelCatchupState> = {};
      unreadChannels.forEach(({ channel, member, unreadCount, mentionCount }) => {
        initialStates[channel.id] = {
          channel,
          member,
          unreadCount,
          mentionCount,
          posts: [],
          isLoading: true,
          isRead: false,
          isMarkingRead: false,
        };
      });

      setChannelStates(initialStates);

      // 各未読チャンネルの投稿を並列フェッチ (同時実行数を制御しながら取得)
      const fetchChannel = async (item: typeof unreadChannels[0]) => {
        const { channel, member } = item;
        try {
          // since に last_viewed_at を指定して新着のみ取得
          const since = member.last_viewed_at > 0 ? member.last_viewed_at : undefined;
          const fetchLimit = Math.min(Math.max(item.unreadCount + 5, 20), 60);

          const res = await getChannelPosts(
            serverUrl,
            token,
            channel.id,
            0,
            fetchLimit,
            undefined,
            corsProxy,
            since
          );

          let postList = res.order.map((id) => res.posts[id]).filter(Boolean);

          // 万一 since 以降が0件だった場合、最新ログをフォールバック取得
          if (postList.length === 0) {
            const fallbackRes = await getChannelPosts(
              serverUrl,
              token,
              channel.id,
              0,
              Math.min(item.unreadCount || 5, 20),
              undefined,
              corsProxy
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
            await resolveMissingUsers(postList.map((p) => p.user_id));
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

      // 5チャンネルずつバッチ実行して過負荷を回避
      const chunkSize = 5;
      for (let i = 0; i < unreadChannels.length; i += chunkSize) {
        if (isCancelled) break;
        const chunk = unreadChannels.slice(i, i + chunkSize);
        await Promise.all(chunk.map((item) => fetchChannel(item)));
      }

      if (!isCancelled) {
        setIsInitializing(false);
      }
    };

    if (unreadChannels.length > 0) {
      initAndFetchPosts();
    } else {
      setIsInitializing(false);
      setChannelStates({});
    }

    return () => {
      isCancelled = true;
    };
  }, [unreadChannels, serverUrl, token, corsProxy, resolveMissingUsers]);

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

  // 4. すべての未読を一括既読化
  const handleMarkAllAsRead = async () => {
    const activeUnreads = Object.values(channelStates).filter((s) => !s.isRead);
    if (activeUnreads.length === 0) return;

    if (!window.confirm(`表示中の未読 ${activeUnreads.length} チャンネルをすべて既読にしますか？`)) {
      return;
    }

    setIsMarkingAllRead(true);
    try {
      await Promise.all(
        activeUnreads.map(async (s) => {
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
        Object.keys(next).forEach((id) => {
          next[id] = { ...next[id], isRead: true };
        });
        return next;
      });
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  // 表示対象のチャンネル（未読または既読処理中のもの）
  const activeChannelList = useMemo(() => {
    return Object.values(channelStates).filter((s) => !s.isRead);
  }, [channelStates]);

  const totalRemainingUnreads = useMemo(() => {
    return activeChannelList.reduce((acc, cur) => acc + (cur.unreadCount || 1), 0);
  }, [activeChannelList]);

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
              {activeChannelList.length} チャンネル / {totalRemainingUnreads} 件
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => onRefreshUnreads()}
            disabled={isInitializing}
            className="flex items-center space-x-1 text-[11px] text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="未読チャンネルを再検索"
          >
            <RefreshCw className={`w-3 h-3 ${isInitializing ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">再検出</span>
          </button>

          {activeChannelList.length > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              disabled={isMarkingAllRead}
              className="flex items-center space-x-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 px-2.5 py-1 rounded transition-colors disabled:opacity-50"
              title="すべての未読チャンネルを既読にする"
            >
              {isMarkingAllRead ? (
                <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
              ) : (
                <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>すべて既読</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Scroll Content */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-4">
        {isInitializing && activeChannelList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400 space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
            <p className="text-xs">未読チャンネルと投稿を読み込み中...</p>
          </div>
        ) : activeChannelList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-950/60 border border-emerald-700/60 flex items-center justify-center text-emerald-400 shadow-lg">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-zinc-200">すべての未読を読み終えました！</p>
              <p className="text-xs text-zinc-500 mt-1">
                現在、新着メッセージのある未読チャンネルはありません。
              </p>
            </div>
            <button
              onClick={onClose}
              className="mt-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-1.5 rounded shadow transition-colors"
            >
              通常ログ閲覧に戻る
            </button>
          </div>
        ) : (
          activeChannelList.map((state) => {
            const { channel, posts, isLoading, isMarkingRead, unreadCount, mentionCount, error } =
              state;

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

                    <span className="font-bold text-xs text-zinc-100 truncate">
                      {channel.display_name || channel.name}
                    </span>

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
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      onClick={() => onSelectChannel(channel)}
                      className="text-zinc-400 hover:text-zinc-200 p-1 hover:bg-zinc-800 rounded text-[11px] flex items-center space-x-1"
                      title="このチャンネルをログビューで開く"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span className="hidden sm:inline">開く</span>
                    </button>

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
