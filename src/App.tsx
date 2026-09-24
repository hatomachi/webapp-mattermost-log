import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AppSettings,
  MattermostChannel,
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
  getChannelPosts,
  getUsersByIds,
} from './services/mattermost';
import { Header } from './components/Header';
import { ChannelSidebar } from './components/ChannelSidebar';
import { LogViewer } from './components/LogViewer';
import { SettingsModal } from './components/SettingsModal';

export const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [channels, setChannels] = useState<MattermostChannel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string>(loadActiveChannelId);
  const [posts, setPosts] = useState<MattermostPost[]>([]);
  const [userCache, setUserCache] = useState<Record<string, MattermostUser>>(loadUserCache);

  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isConnected = Boolean(settings.serverUrl && settings.token);

  // 初回起動時、未設定なら設定モーダルを開く
  useEffect(() => {
    if (!isConnected) {
      setIsSettingsOpen(true);
    }
  }, [isConnected]);

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

      for (const teamId of targetTeamIds) {
        try {
          const chs = await getTeamChannels(
            currentSettings.serverUrl,
            currentSettings.token,
            teamId,
            currentSettings.corsProxy
          );
          const team = teamMap.get(teamId);
          chs.forEach((c) => {
            c.team_display_name = team ? team.display_name || team.name : undefined;
          });
          allChannels.push(...chs);
        } catch (e) {
          console.warn(`Failed to fetch channels for team ${teamId}:`, e);
        }
      }

      // 重複除去（DM等）
      const uniqueChannels = Array.from(
        new Map(allChannels.map((c) => [c.id, c])).values()
      );

      // ソート：公開/非公開チャンネル優先、名前順
      uniqueChannels.sort((a, b) => {
        if (a.type !== b.type) {
          if (a.type === 'O') return -1;
          if (b.type === 'O') return 1;
        }
        return (a.display_name || a.name).localeCompare(b.display_name || b.name, 'ja');
      });

      setChannels(uniqueChannels);

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

  // 初期ロード & 設定変更時のチャンネル取得
  useEffect(() => {
    if (isConnected) {
      fetchChannels(settings);
    }
  }, [settings.serverUrl, settings.token, settings.selectedTeamIds, settings.corsProxy]);

  // メッセージログの取得
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
        settings.corsProxy
      );

      const postList = res.order.map((id) => res.posts[id]).filter(Boolean);
      setPosts(postList);
      setLastUpdated(new Date());

      // 未解決のユーザー情報をまとめて取得
      const missingUserIds = Array.from(
        new Set(
          postList
            .map((p) => p.user_id)
            .filter((uid) => uid && !userCache[uid])
        )
      );

      if (missingUserIds.length > 0) {
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
      }
    } catch (err: any) {
      console.error('Failed to fetch posts:', err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [settings.serverUrl, settings.token, settings.corsProxy, userCache]);

  // アクティブチャンネル変更時に投稿取得
  useEffect(() => {
    if (activeChannelId) {
      fetchPosts(activeChannelId);
    }
  }, [activeChannelId]);

  // 自動更新タイマー (ポーリング)
  useEffect(() => {
    if (!activeChannelId || settings.autoRefreshInterval <= 0) return;

    const timer = setInterval(() => {
      fetchPosts(activeChannelId, true);
    }, settings.autoRefreshInterval * 1000);

    return () => clearInterval(timer);
  }, [activeChannelId, settings.autoRefreshInterval, fetchPosts]);

  const handleSelectChannel = (channel: MattermostChannel) => {
    setActiveChannelId(channel.id);
    saveActiveChannelId(channel.id);
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    fetchChannels(newSettings);
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
        onRefresh={() => activeChannelId && fetchPosts(activeChannelId)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
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

      {/* Main Content: Sidebar + LogViewer */}
      <div className="flex-1 flex overflow-hidden relative">
        <ChannelSidebar
          isOpen={isSidebarOpen}
          channels={channels}
          activeChannelId={activeChannelId}
          onSelectChannel={handleSelectChannel}
          onClose={() => setIsSidebarOpen(false)}
          showTeamBadge={settings.showTeamBadge}
        />

        <LogViewer
          posts={posts}
          userCache={userCache}
          showSeconds={settings.showSeconds}
          fontSize={settings.fontSize}
          isLoading={isLoading}
          channelName={activeChannel?.display_name || activeChannel?.name}
        />
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
