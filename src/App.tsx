import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  AppSettings,
  AppViewMode,
  ChannelSortOrder,
  MattermostChannel,
  MattermostChannelMember,
  MattermostPost,
  MattermostTeam,
  MattermostUser,
} from './types/mattermost';
import {
  loadSettings,
  saveSettings,
  loadActiveChannelId,
  saveActiveChannelId,
  loadUserCache,
  saveUserCache,
} from './services/storage';
import {
  getMyTeams,
  getTeamChannels,
  getTeamChannelMembers,
  getChannelPosts,
  getPostThread,
  getUsersByIds,
} from './services/mattermost';
import { Header } from './components/Header';
import { ChannelSidebar } from './components/ChannelSidebar';
import { LogViewer } from './components/LogViewer';
import { UnreadCatchupViewer } from './components/UnreadCatchupViewer';
import { SettingsModal } from './components/SettingsModal';

export const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [viewMode, setViewMode] = useState<AppViewMode>('log');
  const [channels, setChannels] = useState<MattermostChannel[]>([]);
  const [channelMembers, setChannelMembers] = useState<Record<string, MattermostChannelMember>>({});
  const [activeChannelId, setActiveChannelId] = useState<string>(loadActiveChannelId);
  const [posts, setPosts] = useState<MattermostPost[]>([]);
  const [userCache, setUserCache] = useState<Record<string, MattermostUser>>(loadUserCache);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const [threadPosts, setThreadPosts] = useState<Record<string, MattermostPost[]>>({});
  const [loadingThreads, setLoadingThreads] = useState<Record<string, boolean>>({});

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  // チャンネル一覧の取得
  const fetchChannels = useCallback(async (currentSettings: AppSettings) => {
    if (!currentSettings.serverUrl || !currentSettings.token) return;

    try {
      setIsLoading(true);
      setErrorMsg(null);

      const teams = await getMyTeams(
        currentSettings.serverUrl,
        currentSettings.token,
        currentSettings.corsProxy
      );
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

  // 未読チャンネル数の算出
  const unreadChannelCount = useMemo(() => {
    return channels.filter((ch) => {
      const m = channelMembers[ch.id];
      return (
        m &&
        ch.last_post_at > (m.last_viewed_at || 0) &&
        ch.total_msg_count > (m.msg_count || 0)
      );
    }).length;
  }, [channels, channelMembers]);

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

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden select-none font-mono">
      {/* Header */}
      <Header
        activeChannel={activeChannel}
        isConnected={isConnected}
        isLoading={isLoading}
        lastUpdated={lastUpdated}
        collapseNewlines={settings.collapseNewlines}
        onToggleCollapseNewlines={handleToggleCollapseNewlines}
        onRefresh={() => activeChannelId && fetchPosts(activeChannelId)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        viewMode={viewMode}
        unreadChannelCount={unreadChannelCount}
        onToggleViewMode={() => setViewMode((prev) => (prev === 'catchup' ? 'log' : 'catchup'))}
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
            onSelectChannel={handleSelectChannel}
            onClose={() => setViewMode('log')}
            onChannelMarkedAsRead={handleChannelMarkedAsRead}
            onRefreshUnreads={() => fetchChannels(settings)}
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
            channelName={activeChannel?.display_name || activeChannel?.name}
            hasMorePosts={hasMorePosts}
            isLoadingOlder={isLoadingOlder}
            onLoadOlderPosts={handleLoadOlderPosts}
            threadPosts={threadPosts}
            loadingThreads={loadingThreads}
            onFetchThread={handleFetchThread}
          />
        )}
      </div>

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

