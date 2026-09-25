import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  AppSettings,
  AppViewMode,
  ChannelSortOrder,
  ChannelSubscriptionMode,
  MattermostChannel,
  MattermostChannelMember,
  MattermostPost,
  MattermostTeam,
  MattermostUser,
  MattermostReaction,
  MattermostFileInfo,
} from './types/mattermost';
import {
  loadSettings,
  saveSettings,
  loadActiveChannelId,
  saveActiveChannelId,
  loadUserCache,
  saveUserCache,
  loadChannelSubscriptions,
  saveChannelSubscriptions,
  getEffectiveChannelSubscription,
  loadRecentEmojis,
  addRecentEmoji,
} from './services/storage';
import {
  getMe,
  getMyTeams,
  getTeamChannels,
  getTeamChannelMembers,
  getChannelPosts,
  getPostThread,
  getUsersByIds,
  getChannelUsers,
  createPost,
  uploadFiles,
  buildMattermostChannelUrl,
  viewChannel,
  addReaction,
  removeReaction,
  getPostReactions,
} from './services/mattermost';
import { Header } from './components/Header';
import { ChannelSidebar } from './components/ChannelSidebar';
import { LogViewer } from './components/LogViewer';
import { UnreadCatchupViewer } from './components/UnreadCatchupViewer';
import { SettingsModal } from './components/SettingsModal';
import { AiRemoteChatDrawer } from './components/ai/AiRemoteChatDrawer';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import {
  formatChannelLogsToAttachment,
  formatThreadLogsToAttachment,
  formatUnreadDigestToAttachment,
  formatSinglePostToAttachment,
} from './features/ai/mattermostAiAdapter';
import { ContextAttachment } from './features/ai/aiRemoteTypes';

export const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [viewMode, setViewMode] = useState<AppViewMode>('log');
  const [teams, setTeams] = useState<MattermostTeam[]>([]);
  const [channels, setChannels] = useState<MattermostChannel[]>([]);
  const [channelMembers, setChannelMembers] = useState<Record<string, MattermostChannelMember>>({});
  const [activeChannelId, setActiveChannelId] = useState<string>(loadActiveChannelId);
  const [posts, setPosts] = useState<MattermostPost[]>([]);
  const [userCache, setUserCache] = useState<Record<string, MattermostUser>>(loadUserCache);
  const [currentUser, setCurrentUser] = useState<MattermostUser | null>(null);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(loadRecentEmojis);
  const [channelSubscriptions, setChannelSubscriptions] = useState<Record<string, ChannelSubscriptionMode>>(loadChannelSubscriptions);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const [threadPosts, setThreadPosts] = useState<Record<string, MattermostPost[]>>({});
  const [loadingThreads, setLoadingThreads] = useState<Record<string, boolean>>({});

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // AI壁打ち用ステート
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [aiContextTarget, setAiContextTarget] = useState<{
    type: 'channel' | 'thread' | 'unread' | 'post';
    rootPost?: MattermostPost;
    post?: MattermostPost;
    unreadItems?: Array<{ channel: MattermostChannel; posts: MattermostPost[]; unreadCount: number }>;
  }>({ type: 'channel' });
  const [activeAiAttachment, setActiveAiAttachment] = useState<ContextAttachment | null>(null);
  const [appliedAiDraft, setAppliedAiDraft] = useState<string | null>(null);

  const isConnected = Boolean(settings.serverUrl && settings.token);

  // 初回起動時、未設定なら設定モーダルを開く
  useEffect(() => {
    if (!isConnected) {
      setIsSettingsOpen(true);
    }
  }, [isConnected]);

  const userCacheRef = useRef(userCache);
  useEffect(() => {
    userCacheRef.current = userCache;
  }, [userCache]);

  // 未キャッシュのユーザープロファイルを解決するヘルパー
  const resolveMissingUsers = useCallback(
    async (userIdList: string[]) => {
      const missingUserIds = Array.from(
        new Set(userIdList.filter((uid) => uid && !userCacheRef.current[uid]))
      );
      if (missingUserIds.length === 0) return;

      try {
        const fetchedUsers = await getUsersByIds(
          settings.serverUrl,
          settings.token,
          missingUserIds,
          settings.corsProxy
        );
        if (fetchedUsers.length > 0) {
          setUserCache((prev) => {
            const updated = { ...prev };
            fetchedUsers.forEach((u) => {
              updated[u.id] = u;
            });
            saveUserCache(updated);
            return updated;
          });
        }
      } catch (e) {
        console.warn('Failed to fetch user profiles:', e);
      }
    },
    [settings.serverUrl, settings.token, settings.corsProxy]
  );

  // チャンネル所属メンバーのキャッシュ
  const channelUsersCacheRef = useRef<Record<string, MattermostUser[]>>({});

  // チャンネルメンバー一覧の取得（キャッシュ活用 & userCacheへのマージ）
  const handleFetchChannelUsers = useCallback(
    async (channelId: string): Promise<MattermostUser[]> => {
      if (!settings.serverUrl || !settings.token || !channelId) return [];

      // すでにキャッシュにあれば即座に返却
      if (channelUsersCacheRef.current[channelId]) {
        return channelUsersCacheRef.current[channelId];
      }

      const users = await getChannelUsers(
        settings.serverUrl,
        settings.token,
        channelId,
        settings.corsProxy
      );

      channelUsersCacheRef.current[channelId] = users;

      // 取得したメンバーを全体ユーザーキャッシュにも反映
      if (users.length > 0) {
        setUserCache((prev) => {
          let hasNew = false;
          const updated = { ...prev };
          users.forEach((u) => {
            if (!updated[u.id]) {
              updated[u.id] = u;
              hasNew = true;
            }
          });
          if (hasNew) {
            saveUserCache(updated);
            return updated;
          }
          return prev;
        });
      }

      return users;
    },
    [settings.serverUrl, settings.token, settings.corsProxy]
  );

  // チャンネル一覧の取得
  const fetchChannels = useCallback(async (currentSettings: AppSettings) => {
    if (!currentSettings.serverUrl || !currentSettings.token) return;

    try {
      setIsLoading(true);
      setErrorMsg(null);

      const [me, teams] = await Promise.all([
        getMe(
          currentSettings.serverUrl,
          currentSettings.token,
          currentSettings.corsProxy
        ).catch((e) => {
          console.warn('Failed to fetch me:', e);
          return null;
        }),
        getMyTeams(
          currentSettings.serverUrl,
          currentSettings.token,
          currentSettings.corsProxy
        ),
      ]);

      if (me) {
        setCurrentUser(me);
        setUserCache((prev) => {
          const updated = { ...prev, [me.id]: me };
          saveUserCache(updated);
          return updated;
        });
      }

      setTeams(teams);
      const teamMap = new Map<string, MattermostTeam>(teams.map((t) => [t.id, t]));

      // 選択中チーム（未選択なら全チーム）
      const targetTeamIds =
        currentSettings.selectedTeamIds.length > 0
          ? currentSettings.selectedTeamIds
          : teams.map((t) => t.id);

      const allChannels: MattermostChannel[] = [];
      const memberMap: Record<string, MattermostChannelMember> = {};

      for (const teamId of targetTeamIds) {
        try {
          const [chs, members] = await Promise.all([
            getTeamChannels(
              currentSettings.serverUrl,
              currentSettings.token,
              teamId,
              currentSettings.corsProxy
            ),
            getTeamChannelMembers(
              currentSettings.serverUrl,
              currentSettings.token,
              teamId,
              currentSettings.corsProxy
            ).catch((e) => {
              console.warn(`Failed to fetch channel members for team ${teamId}:`, e);
              return [] as MattermostChannelMember[];
            }),
          ]);

          const team = teamMap.get(teamId);
          chs.forEach((c) => {
            c.team_display_name = team ? team.display_name || team.name : undefined;
            c.team_name = team ? team.name : undefined;
          });
          allChannels.push(...chs);

          members.forEach((m) => {
            memberMap[m.channel_id] = m;
          });
        } catch (e) {
          console.warn(`Failed to fetch channels for team ${teamId}:`, e);
        }
      }

      // 重複除去（DM等）
      const uniqueChannels = Array.from(
        new Map(allChannels.map((c) => [c.id, c])).values()
      );

      setChannels(uniqueChannels);
      setChannelMembers(memberMap);

      // アクティブチャンネルが未設定、または存在しない場合は先頭を選択
      if (uniqueChannels.length > 0) {
        const found = uniqueChannels.find((c) => c.id === activeChannelId);
        if (!found) {
          setActiveChannelId(uniqueChannels[0].id);
          saveActiveChannelId(uniqueChannels[0].id);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'チャンネル一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [activeChannelId]);

  // 未読チャンネル数の算出（メイン未読・メンションのみ低優先未読の分類）
  const { totalUnreadCount, mainUnreadCount, mentionOnlyUnreadCount } = useMemo(() => {
    let total = 0;
    let main = 0;
    let mentionOnly = 0;
    channels.forEach((ch) => {
      const m = channelMembers[ch.id];
      const isUnread =
        m &&
        ch.last_post_at > (m.last_viewed_at || 0) &&
        ch.total_msg_count > (m.msg_count || 0);
      if (isUnread) {
        total++;
        const isMentionOnly =
          getEffectiveChannelSubscription(ch.id, m, channelSubscriptions) === 'mention';
        if (!isMentionOnly || (m.mention_count || 0) > 0) {
          main++;
        } else {
          mentionOnly++;
        }
      }
    });
    return {
      totalUnreadCount: total,
      mainUnreadCount: main,
      mentionOnlyUnreadCount: mentionOnly,
    };
  }, [channels, channelMembers, channelSubscriptions]);

  const unreadChannelCount = totalUnreadCount;

  // チャンネル購読モード（通常/メンションのみ）の切り替えハンドラー
  const handleToggleChannelSubscription = useCallback((channelId: string) => {
    setChannelSubscriptions((prev) => {
      const member = channelMembers[channelId];
      const currentEffective = getEffectiveChannelSubscription(channelId, member, prev);
      const nextMode: ChannelSubscriptionMode = currentEffective === 'mention' ? 'all' : 'mention';
      const updated = {
        ...prev,
        [channelId]: nextMode,
      };
      saveChannelSubscriptions(updated);
      return updated;
    });
  }, [channelMembers]);

  // チャンネル既読化ハンドラー（キャッチアップ画面からの既読化通知）
  const handleChannelMarkedAsRead = useCallback((channelId: string) => {
    const ch = channels.find((c) => c.id === channelId);
    setChannelMembers((prev) => {
      const existing = prev[channelId];
      return {
        ...prev,
        [channelId]: {
          channel_id: channelId,
          user_id: existing?.user_id || '',
          roles: existing?.roles || '',
          last_viewed_at: Date.now(),
          msg_count: ch ? ch.total_msg_count : existing?.msg_count || 0,
          mention_count: 0,
        },
      };
    });
  }, [channels]);

  // 初期ロード & 設定変更時のチャンネル取得
  useEffect(() => {
    if (isConnected) {
      fetchChannels(settings);
    }
  }, [settings.serverUrl, settings.token, settings.selectedTeamIds, settings.corsProxy]);

  // メッセージログの取得（最新ログ）
  const fetchPosts = useCallback(async (channelId: string, silent = false) => {
    if (!settings.serverUrl || !settings.token || !channelId) return;

    if (!silent) setIsLoading(true);
    try {
      const res = await getChannelPosts(
        settings.serverUrl,
        settings.token,
        channelId,
        0,
        60,
        undefined,
        settings.corsProxy
      );

      const postList = res.order.map((id) => res.posts[id]).filter(Boolean);
      setPosts(postList);
      setHasMorePosts(postList.length >= 60);
      setLastUpdated(new Date());

      // 未解決のユーザー情報をまとめて取得
      await resolveMissingUsers(postList.map((p) => p.user_id));
    } catch (err: any) {
      console.error('Failed to fetch posts:', err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [settings.serverUrl, settings.token, settings.corsProxy, resolveMissingUsers]);

  // 過去ログ追加取得 (Pagination)
  const handleLoadOlderPosts = useCallback(async () => {
    if (!settings.serverUrl || !settings.token || !activeChannelId || isLoadingOlder) return;

    // 現在取得済みの最も古い投稿IDを取得
    const sorted = [...posts].sort((a, b) => a.create_at - b.create_at);
    const oldestPost = sorted[0];
    if (!oldestPost) return;

    setIsLoadingOlder(true);
    try {
      const res = await getChannelPosts(
        settings.serverUrl,
        settings.token,
        activeChannelId,
        0,
        60,
        oldestPost.id,
        settings.corsProxy
      );

      const olderPostList = res.order.map((id) => res.posts[id]).filter(Boolean);

      if (olderPostList.length === 0) {
        setHasMorePosts(false);
      } else {
        // 重複を除外して既存の投稿リストの先頭に追加
        const existingIds = new Set(posts.map((p) => p.id));
        const newPosts = olderPostList.filter((p) => !existingIds.has(p.id));
        setPosts((prev) => [...newPosts, ...prev]);
        if (olderPostList.length < 60) {
          setHasMorePosts(false);
        }
        await resolveMissingUsers(newPosts.map((p) => p.user_id));
      }
    } catch (err: any) {
      console.error('Failed to load older posts:', err);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [settings.serverUrl, settings.token, settings.corsProxy, activeChannelId, posts, isLoadingOlder, resolveMissingUsers]);

  // スレッド返信取得
  const handleFetchThread = useCallback(async (postId: string) => {
    if (!settings.serverUrl || !settings.token) return;

    setLoadingThreads((prev) => ({ ...prev, [postId]: true }));
    try {
      const res = await getPostThread(
        settings.serverUrl,
        settings.token,
        postId,
        settings.corsProxy
      );
      const threadList = res.order.map((id) => res.posts[id]).filter(Boolean);
      setThreadPosts((prev) => ({ ...prev, [postId]: threadList }));
      await resolveMissingUsers(threadList.map((p) => p.user_id));
    } catch (err: any) {
      console.error(`Failed to fetch thread for post ${postId}:`, err);
    } finally {
      setLoadingThreads((prev) => ({ ...prev, [postId]: false }));
    }
  }, [settings.serverUrl, settings.token, settings.corsProxy, resolveMissingUsers]);

  // ファイルアップロードハンドラー
  const handleUploadFile = useCallback(
    async (file: File): Promise<MattermostFileInfo> => {
      if (!settings.serverUrl || !settings.token || !activeChannelId) {
        throw new Error('サーバーに接続されていないか、チャンネルが未選択です');
      }

      const fileInfos = await uploadFiles(
        settings.serverUrl,
        settings.token,
        activeChannelId,
        [file],
        settings.corsProxy
      );

      if (!fileInfos || fileInfos.length === 0) {
        throw new Error('ファイルのアップロードに失敗しました');
      }

      return fileInfos[0];
    },
    [settings.serverUrl, settings.token, settings.corsProxy, activeChannelId]
  );

  // メッセージ投稿・スレッド返信ハンドラー
  const handleSendPost = useCallback(
    async (message: string, rootId?: string, fileIds?: string[]): Promise<boolean> => {
      if (!settings.serverUrl || !settings.token || !activeChannelId) {
        throw new Error('サーバーに接続されていないか、チャンネルが未選択です');
      }

      const newPost = await createPost(
        settings.serverUrl,
        settings.token,
        activeChannelId,
        message,
        rootId,
        fileIds,
        settings.corsProxy
      );

      // 新規親投稿の場合
      if (!rootId) {
        setPosts((prev) => [...prev, newPost]);
        // チャンネル一覧の最終投稿日時とメッセージ数を更新
        setChannels((prev) =>
          prev.map((c) =>
            c.id === activeChannelId
              ? {
                  ...c,
                  last_post_at: newPost.create_at,
                  total_msg_count: (c.total_msg_count || 0) + 1,
                }
              : c
          )
        );
        if (!userCache[newPost.user_id]) {
          await resolveMissingUsers([newPost.user_id]);
        }
      } else {
        // スレッド返信の場合: 親投稿の返信数とスレッドリストを更新
        setPosts((prev) =>
          prev.map((p) =>
            p.id === rootId
              ? { ...p, reply_count: (p.reply_count || 0) + 1 }
              : p
          )
        );
        setThreadPosts((prev) => {
          const current = prev[rootId] || [];
          return {
            ...prev,
            [rootId]: [...current, newPost],
          };
        });
        if (!userCache[newPost.user_id]) {
          await resolveMissingUsers([newPost.user_id]);
        }
      }

      return true;
    },
    [settings.serverUrl, settings.token, settings.corsProxy, activeChannelId, userCache, resolveMissingUsers]
  );

  // リアクション（スタンプ）のトグル追加・削除（楽観的UI更新付き）
  const handleToggleReaction = useCallback(
    async (postId: string, emojiName: string) => {
      if (!settings.serverUrl || !settings.token) return;
      const cleanName = emojiName.trim().replace(/^:+|:+$/g, '');
      if (!cleanName) return;

      // ユーザーIDの確保
      let userId = currentUser?.id;
      if (!userId) {
        try {
          const me = await getMe(settings.serverUrl, settings.token, settings.corsProxy);
          setCurrentUser(me);
          userId = me.id;
        } catch (e: any) {
          setErrorMsg('ユーザー情報の取得に失敗しました: ' + (e.message || ''));
          return;
        }
      }

      // 対象投稿の探索（メイン投稿または展開中スレッド返信）
      let targetPost: MattermostPost | undefined = posts.find((p) => p.id === postId);
      let targetRootId: string | undefined;

      if (!targetPost) {
        for (const [rId, rList] of Object.entries(threadPosts)) {
          const found = rList.find((p) => p.id === postId);
          if (found) {
            targetPost = found;
            targetRootId = rId;
            break;
          }
        }
      }

      const currentReactions = targetPost ? getPostReactions(targetPost) : [];
      const existingReaction = currentReactions.find(
        (r) => r.emoji_name === cleanName && r.user_id === userId
      );
      const isRemoving = Boolean(existingReaction);

      // 楽観的更新
      let newReactions: MattermostReaction[];
      if (isRemoving) {
        newReactions = currentReactions.filter(
          (r) => !(r.emoji_name === cleanName && r.user_id === userId)
        );
      } else {
        newReactions = [
          ...currentReactions,
          {
            user_id: userId,
            post_id: postId,
            emoji_name: cleanName,
            create_at: Date.now(),
          },
        ];
        // 最近使ったスタンプに追加
        setRecentEmojis(addRecentEmoji(cleanName));
      }

      const updatePostReactions = (p: MattermostPost): MattermostPost => {
        if (p.id !== postId) return p;
        return {
          ...p,
          has_reactions: newReactions.length > 0,
          metadata: {
            ...(p.metadata || {}),
            reactions: newReactions,
          },
        };
      };

      if (targetPost) {
        setPosts((prev) => prev.map(updatePostReactions));
        if (targetRootId) {
          setThreadPosts((prev) => ({
            ...prev,
            [targetRootId!]: prev[targetRootId!]?.map(updatePostReactions) || [],
          }));
        }
      }

      // API 実行
      try {
        if (isRemoving) {
          await removeReaction(
            settings.serverUrl,
            settings.token,
            userId,
            postId,
            cleanName,
            settings.corsProxy
          );
        } else {
          await addReaction(
            settings.serverUrl,
            settings.token,
            userId,
            postId,
            cleanName,
            settings.corsProxy
          );
        }
      } catch (err: any) {
        console.error('Failed to toggle reaction:', err);
        setErrorMsg(`スタンプ操作に失敗しました: ${err.message || ''}`);
        // ロールバック
        if (targetPost) {
          const rollbackPostReactions = (p: MattermostPost): MattermostPost => {
            if (p.id !== postId) return p;
            return {
              ...p,
              has_reactions: currentReactions.length > 0,
              metadata: {
                ...(p.metadata || {}),
                reactions: currentReactions,
              },
            };
          };
          setPosts((prev) => prev.map(rollbackPostReactions));
          if (targetRootId) {
            setThreadPosts((prev) => ({
              ...prev,
              [targetRootId!]: prev[targetRootId!]?.map(rollbackPostReactions) || [],
            }));
          }
        }
      }
    },
    [settings, currentUser, posts, threadPosts]
  );

  const handleAddReaction = useCallback(
    async (postId: string, emojiName: string) => {
      await handleToggleReaction(postId, emojiName);
    },
    [handleToggleReaction]
  );

  // アクティブチャンネル変更時に投稿取得 & スレッド初期化
  useEffect(() => {
    if (activeChannelId) {
      setThreadPosts({});
      setLoadingThreads({});
      setHasMorePosts(true);
      fetchPosts(activeChannelId);
    }
  }, [activeChannelId]);

  // 自動更新タイマー (ポーリング: 通常ログビュー表示時のみ動作)
  useEffect(() => {
    if (viewMode !== 'log' || !activeChannelId || settings.autoRefreshInterval <= 0) return;

    const timer = setInterval(() => {
      fetchPosts(activeChannelId, true);
    }, settings.autoRefreshInterval * 1000);

    return () => clearInterval(timer);
  }, [viewMode, activeChannelId, settings.autoRefreshInterval, fetchPosts]);

  const handleSelectChannel = (channel: MattermostChannel) => {
    setActiveChannelId(channel.id);
    saveActiveChannelId(channel.id);
    setViewMode('log');
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    fetchChannels(newSettings);
  };

  const handleToggleSortOrder = (newOrder: ChannelSortOrder) => {
    const updated: AppSettings = { ...settings, channelSortOrder: newOrder };
    setSettings(updated);
    saveSettings(updated);
  };

  const handleToggleCollapseNewlines = () => {
    const updated: AppSettings = {
      ...settings,
      collapseNewlines: !settings.collapseNewlines,
    };
    setSettings(updated);
    saveSettings(updated);
  };

  const handleToggleShowReactions = () => {
    const updated: AppSettings = {
      ...settings,
      showReactions: !settings.showReactions,
    };
    setSettings(updated);
    saveSettings(updated);
  };

  // AIトピックID（ワークスペース分離キー: チャンネルID または スレッドID）
  // 現在の画面状態に応じたコンテキスト添付（Attachment）を動的に生成
  const getCurrentContextAttachment = useCallback((): ContextAttachment | null => {
    // 1. 未読ビュー時、または未読コンテキスト時
    if (aiContextTarget.type === 'unread' && aiContextTarget.unreadItems && aiContextTarget.unreadItems.length > 0) {
      return formatUnreadDigestToAttachment({
        unreadItems: aiContextTarget.unreadItems,
        userCache,
      });
    }

    const ch = channels.find((c) => c.id === activeChannelId);

    // 2. スレッド指定時
    if (aiContextTarget.type === 'thread' && aiContextTarget.rootPost) {
      const root = aiContextTarget.rootPost;
      const replies = threadPosts[root.id] || [];
      return formatThreadLogsToAttachment({
        channel: ch,
        rootPost: root,
        replies,
        userCache,
        serverUrl: settings.serverUrl,
        webUrl: settings.webUrl,
        teams,
      });
    }

    // 3. 単一投稿指定時
    if (aiContextTarget.type === 'post' && aiContextTarget.post) {
      return formatSinglePostToAttachment({
        channel: ch,
        post: aiContextTarget.post,
        userCache,
        serverUrl: settings.serverUrl,
        webUrl: settings.webUrl,
        teams,
      });
    }

    // 4. 通常のチャンネルログ表示時
    if (posts.length > 0) {
      return formatChannelLogsToAttachment({
        channel: ch,
        posts,
        userCache,
        threadPosts,
        maxPosts: 100,
        serverUrl: settings.serverUrl,
        webUrl: settings.webUrl,
        teams,
      });
    }

    return null;
  }, [aiContextTarget, channels, activeChannelId, posts, userCache, threadPosts, settings.serverUrl, settings.webUrl, teams]);

  // AIトピック表示名
  const aiTopicTitle = useMemo(() => {
    if (aiContextTarget.type === 'unread') {
      const count = aiContextTarget.unreadItems?.length || 0;
      return `未読キャッチアップ (${count}チャンネル)`;
    }
    const ch = channels.find((c) => c.id === activeChannelId);
    const chName = ch ? `#${ch.display_name || ch.name}` : '未選択';
    if (aiContextTarget.type === 'thread' && aiContextTarget.rootPost) {
      const user = userCache[aiContextTarget.rootPost.user_id];
      const author = user ? user.nickname || user.username : 'ユーザー';
      return `${chName} > スレッド: @${author}`;
    }
    if (aiContextTarget.type === 'post' && aiContextTarget.post) {
      const user = userCache[aiContextTarget.post.user_id];
      const author = user ? user.nickname || user.username : 'ユーザー';
      return `${chName} > @${author}の発言`;
    }
    return chName;
  }, [aiContextTarget, channels, activeChannelId, userCache]);

  const handleOpenAiForChannel = useCallback(() => {
    setAiContextTarget({ type: 'channel' });
    const ch = channels.find((c) => c.id === activeChannelId);
    if (posts.length > 0) {
      const att = formatChannelLogsToAttachment({
        channel: ch,
        posts,
        userCache,
        threadPosts,
        maxPosts: 100,
        serverUrl: settings.serverUrl,
        webUrl: settings.webUrl,
        teams,
      });
      setActiveAiAttachment(att);
    } else {
      setActiveAiAttachment(null);
    }
    setIsAiDrawerOpen(true);
  }, [channels, activeChannelId, posts, userCache, threadPosts, settings.serverUrl, settings.webUrl, teams]);

  const handleOpenAiForThread = useCallback((rootPost: MattermostPost) => {
    if (!threadPosts[rootPost.id] && !loadingThreads[rootPost.id]) {
      handleFetchThread(rootPost.id);
    }
    setAiContextTarget({ type: 'thread', rootPost });
    const ch = channels.find((c) => c.id === activeChannelId);
    const replies = threadPosts[rootPost.id] || [];
    const att = formatThreadLogsToAttachment({
      channel: ch,
      rootPost,
      replies,
      userCache,
      serverUrl: settings.serverUrl,
      webUrl: settings.webUrl,
      teams,
    });
    setActiveAiAttachment(att);
    setIsAiDrawerOpen(true);
  }, [channels, activeChannelId, threadPosts, loadingThreads, userCache, handleFetchThread, settings.serverUrl, settings.webUrl, teams]);

  const handleOpenAiForUnreads = useCallback((unreadItems: Array<{ channel: MattermostChannel; posts: MattermostPost[]; unreadCount: number }>) => {
    setAiContextTarget({ type: 'unread', unreadItems });
    const att = formatUnreadDigestToAttachment({
      unreadItems,
      userCache,
    });
    setActiveAiAttachment(att);
    setIsAiDrawerOpen(true);
  }, [userCache]);

  const handleOpenAiForChannelPosts = useCallback((channel: MattermostChannel, chPosts: MattermostPost[]) => {
    setAiContextTarget({ type: 'channel' });
    const att = formatChannelLogsToAttachment({
      channel,
      posts: chPosts,
      userCache,
      maxPosts: 100,
      serverUrl: settings.serverUrl,
      webUrl: settings.webUrl,
      teams,
    });
    setActiveAiAttachment(att);
    setIsAiDrawerOpen(true);
  }, [userCache, settings.serverUrl, settings.webUrl, teams]);

  const handleApplyDraftToInput = (text: string) => {
    setAppliedAiDraft(text);
  };

  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const activeMember = activeChannelId ? channelMembers[activeChannelId] : undefined;
  const isCurrentChannelUnread = useMemo(() => {
    if (!activeChannel || !activeMember) return false;
    return (
      activeChannel.last_post_at > (activeMember.last_viewed_at || 0) &&
      activeChannel.total_msg_count > (activeMember.msg_count || 0)
    );
  }, [activeChannel, activeMember]);

  const currentChannelUnreadCount = useMemo(() => {
    if (!isCurrentChannelUnread || !activeChannel || !activeMember) return 0;
    return Math.max(1, activeChannel.total_msg_count - (activeMember.msg_count || 0));
  }, [isCurrentChannelUnread, activeChannel, activeMember]);

  const isCurrentChannelMentionOnly = useMemo(() => {
    if (!activeChannelId) return false;
    return (
      getEffectiveChannelSubscription(
        activeChannelId,
        channelMembers[activeChannelId],
        channelSubscriptions
      ) === 'mention'
    );
  }, [activeChannelId, channelMembers, channelSubscriptions]);

  const [isMarkingCurrentChannelRead, setIsMarkingCurrentChannelRead] = useState(false);

  // 現在のアクティブチャンネルを既読化
  const handleMarkCurrentChannelAsRead = useCallback(async () => {
    if (!activeChannelId || !settings.serverUrl || !settings.token || isMarkingCurrentChannelRead) return;

    setIsMarkingCurrentChannelRead(true);
    try {
      await viewChannel(
        settings.serverUrl,
        settings.token,
        activeChannelId,
        '',
        settings.corsProxy
      );
      handleChannelMarkedAsRead(activeChannelId);
    } catch (err: any) {
      console.error('Failed to mark channel as read:', err);
      alert(`既読化に失敗しました: ${err.message || 'エラーが発生しました'}`);
    } finally {
      setIsMarkingCurrentChannelRead(false);
    }
  }, [activeChannelId, settings.serverUrl, settings.token, settings.corsProxy, isMarkingCurrentChannelRead, handleChannelMarkedAsRead]);

  const activeChannelUrl = buildMattermostChannelUrl(
    settings.serverUrl,
    activeChannel,
    teams,
    settings.webUrl
  );

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden select-none font-mono">
      {/* Header */}
      <Header
        activeChannel={activeChannel}
        channelUrl={activeChannelUrl}
        isConnected={isConnected}
        isLoading={isLoading}
        lastUpdated={lastUpdated}
        collapseNewlines={settings.collapseNewlines}
        onToggleCollapseNewlines={handleToggleCollapseNewlines}
        showReactions={settings.showReactions}
        onToggleShowReactions={handleToggleShowReactions}
        onRefresh={() => activeChannelId && fetchPosts(activeChannelId)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        viewMode={viewMode}
        unreadChannelCount={unreadChannelCount}
        mainUnreadCount={mainUnreadCount}
        mentionOnlyUnreadCount={mentionOnlyUnreadCount}
        onToggleViewMode={() => setViewMode((prev) => (prev === 'catchup' ? 'log' : 'catchup'))}
        isAiDrawerOpen={isAiDrawerOpen}
        onToggleAiDrawer={() => setIsAiDrawerOpen((prev) => !prev)}
        isCurrentChannelUnread={isCurrentChannelUnread}
        currentChannelUnreadCount={currentChannelUnreadCount}
        onMarkCurrentChannelAsRead={handleMarkCurrentChannelAsRead}
        isMarkingCurrentChannelRead={isMarkingCurrentChannelRead}
        isCurrentChannelMentionOnly={isCurrentChannelMentionOnly}
        onToggleCurrentChannelSubscription={() => activeChannelId && handleToggleChannelSubscription(activeChannelId)}
      />

      {/* Error alert banner */}
      {errorMsg && (
        <div className="bg-rose-950/90 border-b border-rose-800 text-rose-300 text-xs px-3 py-1 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-rose-400 hover:text-rose-100 ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Main Content: Sidebar + (LogViewer or UnreadCatchupViewer) */}
      <div className="flex-1 flex overflow-hidden relative">
        <ChannelSidebar
          isOpen={isSidebarOpen}
          channels={channels}
          channelMembers={channelMembers}
          activeChannelId={activeChannelId}
          onSelectChannel={handleSelectChannel}
          onClose={() => setIsSidebarOpen(false)}
          showTeamBadge={settings.showTeamBadge}
          sortOrder={settings.channelSortOrder || 'recent'}
          onToggleSortOrder={handleToggleSortOrder}
          onOpenCatchup={() => setViewMode('catchup')}
          serverUrl={settings.serverUrl}
          webUrl={settings.webUrl}
          teams={teams}
          channelSubscriptions={channelSubscriptions}
          onToggleChannelSubscription={handleToggleChannelSubscription}
        />

        {viewMode === 'catchup' ? (
          <UnreadCatchupViewer
            serverUrl={settings.serverUrl}
            token={settings.token}
            corsProxy={settings.corsProxy}
            channels={channels}
            channelMembers={channelMembers}
            userCache={userCache}
            resolveMissingUsers={resolveMissingUsers}
            fontSize={settings.fontSize}
            showSeconds={settings.showSeconds}
            showTeamBadge={settings.showTeamBadge}
            collapseNewlines={settings.collapseNewlines}
            showReactions={settings.showReactions}
            onSelectChannel={handleSelectChannel}
            onClose={() => setViewMode('log')}
            onChannelMarkedAsRead={handleChannelMarkedAsRead}
            onRefreshUnreads={() => fetchChannels(settings)}
            teams={teams}
            webUrl={settings.webUrl}
            onOpenAiWithUnreads={handleOpenAiForUnreads}
            onOpenAiWithChannelPosts={handleOpenAiForChannelPosts}
            channelSubscriptions={channelSubscriptions}
            onToggleChannelSubscription={handleToggleChannelSubscription}
            currentUserId={currentUser?.id}
            favoriteEmojis={settings.favoriteEmojis}
            recentEmojis={recentEmojis}
            onToggleReaction={handleToggleReaction}
            onAddReaction={handleAddReaction}
          />
        ) : (
          <LogViewer
            posts={posts}
            userCache={userCache}
            showSeconds={settings.showSeconds}
            fontSize={settings.fontSize}
            isLoading={isLoading}
            collapseNewlines={settings.collapseNewlines}
            onToggleCollapseNewlines={handleToggleCollapseNewlines}
            showReactions={settings.showReactions}
            onToggleShowReactions={handleToggleShowReactions}
            channelId={activeChannelId || undefined}
            channelName={activeChannel?.display_name || activeChannel?.name}
            onFetchChannelUsers={handleFetchChannelUsers}
            hasMorePosts={hasMorePosts}
            isLoadingOlder={isLoadingOlder}
            onLoadOlderPosts={handleLoadOlderPosts}
            threadPosts={threadPosts}
            loadingThreads={loadingThreads}
            onFetchThread={handleFetchThread}
            onUploadFile={handleUploadFile}
            onSendPost={handleSendPost}
            onOpenAiWithThread={handleOpenAiForThread}
            onOpenAiWithChannel={handleOpenAiForChannel}
            appliedDraft={appliedAiDraft}
            onClearAppliedDraft={() => setAppliedAiDraft(null)}
            isUnread={isCurrentChannelUnread}
            unreadCount={currentChannelUnreadCount}
            onMarkAsRead={handleMarkCurrentChannelAsRead}
            isMarkingRead={isMarkingCurrentChannelRead}
            isMentionOnly={isCurrentChannelMentionOnly}
            onToggleChannelSubscription={() => activeChannelId && handleToggleChannelSubscription(activeChannelId)}
            currentUserId={currentUser?.id}
            favoriteEmojis={settings.favoriteEmojis}
            recentEmojis={recentEmojis}
            onToggleReaction={handleToggleReaction}
            onAddReaction={handleAddReaction}
          />
        )}
      </div>

      {/* AI Wall-bounce Chat Drawer (Remote Hub + Agent) */}
      <ErrorBoundary fallbackTitle="AIリモート画面でエラーが発生しました">
        <AiRemoteChatDrawer
          isOpen={isAiDrawerOpen}
          onClose={() => setIsAiDrawerOpen(false)}
          settings={settings}
          topicTitle={aiTopicTitle}
          initialAttachment={activeAiAttachment}
          getCurrentContextAttachment={getCurrentContextAttachment}
          onApplyDraftToInput={handleApplyDraftToInput}
          onOpenSettings={() => {
            setIsAiDrawerOpen(false);
            setIsSettingsOpen(true);
          }}
        />
      </ErrorBoundary>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />
    </div>
  );
};

export default App;

