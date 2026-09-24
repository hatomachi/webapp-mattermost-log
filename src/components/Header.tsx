import React from 'react';
import { AppViewMode, MattermostChannel } from '../types/mattermost';
import { Menu, RefreshCw, Settings, Hash, Lock, Users, User, WifiOff, Terminal, WrapText, Sparkles, BookOpen } from 'lucide-react';

interface Props {
  activeChannel?: MattermostChannel;
  isConnected: boolean;
  isLoading: boolean;
  lastUpdated: Date | null;
  collapseNewlines?: boolean;
  onToggleCollapseNewlines?: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  viewMode: AppViewMode;
  unreadChannelCount: number;
  onToggleViewMode: () => void;
}

export const Header: React.FC<Props> = ({
  activeChannel,
  isConnected,
  isLoading,
  lastUpdated,
  collapseNewlines = false,
  onToggleCollapseNewlines,
  onRefresh,
  onOpenSettings,
  onToggleSidebar,
  viewMode,
  unreadChannelCount,
  onToggleViewMode,
}) => {
  const getChannelIcon = (type?: string) => {
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

  const formatLastUpdated = (date: Date | null) => {
    if (!date) return '';
    return date.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <header className="h-11 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-3 safe-top shrink-0 select-none font-mono">
      {/* Left: Sidebar Toggle & Channel Title */}
      <div className="flex items-center space-x-2 min-w-0">
        <button
          onClick={onToggleSidebar}
          aria-label="Toggle Channels"
          className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
        >
          <Menu className="w-4 h-4" />
        </button>

        {viewMode === 'catchup' ? (
          <div className="flex items-center space-x-2 min-w-0">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-bold text-xs text-zinc-100 truncate">
              未読キャッチアップ
            </span>
            <span className="text-[10px] bg-emerald-950 border border-emerald-800 text-emerald-300 px-1.5 py-0.2 rounded-full font-bold">
              {unreadChannelCount} ch
            </span>
          </div>
        ) : activeChannel ? (
          <div className="flex items-center space-x-2 min-w-0">
            {getChannelIcon(activeChannel.type)}
            {activeChannel.team_display_name && (
              <span className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded font-mono truncate max-w-[90px] border border-zinc-700">
                {activeChannel.team_display_name}
              </span>
            )}
            <span className="font-bold text-xs text-zinc-100 truncate">
              {activeChannel.display_name || activeChannel.name}
            </span>
            {activeChannel.header && (
              <span className="hidden md:inline text-[10px] text-zinc-500 truncate max-w-[280px]">
                - {activeChannel.header}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center space-x-1.5 text-zinc-400 text-xs">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-zinc-200">MatterLog</span>
            <span className="text-[10px] text-zinc-500">v0.1</span>
          </div>
        )}
      </div>

      {/* Right: Status, Mode Toggle, Refresh, Settings */}
      <div className="flex items-center space-x-1.5 shrink-0 text-xs">
        {/* Mode Toggle Button */}
        {viewMode === 'catchup' ? (
          <button
            onClick={onToggleViewMode}
            className="flex items-center space-x-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 px-2 py-1 rounded transition-colors"
            title="ログ閲覧ビューに戻る"
          >
            <BookOpen className="w-3.5 h-3.5 text-sky-400" />
            <span>ログ閲覧</span>
          </button>
        ) : (
          <button
            onClick={onToggleViewMode}
            className={`flex items-center space-x-1 text-[11px] px-2 py-1 rounded border transition-colors ${
              unreadChannelCount > 0
                ? 'bg-emerald-950/80 hover:bg-emerald-900 border-emerald-700 text-emerald-300 font-bold shadow-xs'
                : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-400'
            }`}
            title="未読チャンネルの一括キャッチアップビューを開く"
          >
            <Sparkles className={`w-3 h-3 ${unreadChannelCount > 0 ? 'text-emerald-400 animate-pulse' : 'text-zinc-500'}`} />
            <span>未読</span>
            <span
              className={`text-[9px] px-1 py-0.1 rounded-full ${
                unreadChannelCount > 0
                  ? 'bg-emerald-800 text-white'
                  : 'bg-zinc-800 text-zinc-500'
              }`}
            >
              {unreadChannelCount}
            </span>
          </button>
        )}

        {lastUpdated && viewMode === 'log' && (
          <span className="hidden sm:inline text-[10px] text-zinc-500 mr-1">
            {formatLastUpdated(lastUpdated)}
          </span>
        )}

        {!isConnected ? (
          <button
            onClick={onOpenSettings}
            className="flex items-center space-x-1 text-[10px] bg-rose-950/80 border border-rose-800 text-rose-300 px-2 py-0.5 rounded hover:bg-rose-900 transition-colors mr-1"
          >
            <WifiOff className="w-3 h-3 text-rose-400 animate-pulse" />
            <span>未接続 (設定)</span>
          </button>
        ) : null}

        {onToggleCollapseNewlines && (
          <button
            onClick={onToggleCollapseNewlines}
            aria-label="Toggle newline collapse"
            title={collapseNewlines ? '改行無視中（クリックで通常改行へ）' : '改行を無視して表示（クリックで切替）'}
            className={`p-1.5 rounded transition-colors ${
              collapseNewlines
                ? 'bg-amber-950/80 text-amber-300 border border-amber-600/70 hover:bg-amber-900/80'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
          >
            <WrapText className="w-3.5 h-3.5" />
          </button>
        )}

        {viewMode === 'log' && (
          <button
            onClick={onRefresh}
            disabled={isLoading || !isConnected}
            aria-label="Refresh logs"
            title="最新ログを取得"
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        )}

        <button
          onClick={onOpenSettings}
          aria-label="Settings"
          title="接続・表示設定"
          className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
