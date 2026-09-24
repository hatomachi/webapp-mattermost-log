import React, { useState, useMemo } from 'react';
import { ChannelSortOrder, MattermostChannel, MattermostChannelMember } from '../types/mattermost';
import { Search, Hash, Lock, User, Users, X, Layers, Clock, ArrowDownAZ, Sparkles, AtSign } from 'lucide-react';

interface Props {
  isOpen: boolean;
  channels: MattermostChannel[];
  channelMembers?: Record<string, MattermostChannelMember>;
  activeChannelId: string;
  onSelectChannel: (channel: MattermostChannel) => void;
  onClose: () => void;
  showTeamBadge: boolean;
  sortOrder: ChannelSortOrder;
  onToggleSortOrder: (order: ChannelSortOrder) => void;
  onOpenCatchup?: () => void;
}

const formatRelativeTime = (timestamp?: number): string => {
  if (!timestamp || timestamp <= 0) return '';
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60 * 1000) return '今';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}分前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}h前`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))}d前`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export const ChannelSidebar: React.FC<Props> = ({
  isOpen,
  channels,
  channelMembers = {},
  activeChannelId,
  onSelectChannel,
  onClose,
  showTeamBadge,
  sortOrder,
  onToggleSortOrder,
  onOpenCatchup,
}) => {
  const [filterText, setFilterText] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL'); // ALL, UNREAD, CHANNELS, DM

  // 未読情報ヘルパー
  const getUnreadInfo = (ch: MattermostChannel) => {
    const member = channelMembers[ch.id];
    if (!member) return { isUnread: false, unreadCount: 0, mentionCount: 0 };
    const isUnread =
      ch.last_post_at > (member.last_viewed_at || 0) &&
      ch.total_msg_count > (member.msg_count || 0);
    const unreadCount = isUnread
      ? Math.max(1, ch.total_msg_count - (member.msg_count || 0))
      : 0;
    return {
      isUnread,
      unreadCount,
      mentionCount: member.mention_count || 0,
    };
  };

  const totalUnreadChannels = useMemo(() => {
    return channels.filter((ch) => getUnreadInfo(ch).isUnread).length;
  }, [channels, channelMembers]);

  const filteredAndSortedChannels = useMemo(() => {
    const filtered = channels.filter((ch) => {
      // Type filter
      if (selectedType !== 'ALL') {
        if (selectedType === 'UNREAD') {
          if (!getUnreadInfo(ch).isUnread) return false;
        }
        if (selectedType === 'CHANNELS' && ch.type !== 'O' && ch.type !== 'P') return false;
        if (selectedType === 'DM' && ch.type !== 'D' && ch.type !== 'G') return false;
      }

      // Text filter (name, display_name, team_display_name)
      if (!filterText.trim()) return true;
      const q = filterText.toLowerCase();
      const matchName = ch.name.toLowerCase().includes(q);
      const matchDisplay = (ch.display_name || '').toLowerCase().includes(q);
      const matchTeam = (ch.team_display_name || '').toLowerCase().includes(q);
      return matchName || matchDisplay || matchTeam;
    });

    return [...filtered].sort((a, b) => {
      // 未読フィルター時はメンションと更新順を優先
      if (selectedType === 'UNREAD') {
        const unreadA = getUnreadInfo(a);
        const unreadB = getUnreadInfo(b);
        if (unreadA.mentionCount !== unreadB.mentionCount) {
          return unreadB.mentionCount - unreadA.mentionCount;
        }
      }
      if (sortOrder === 'recent') {
        const timeA = a.last_post_at || 0;
        const timeB = b.last_post_at || 0;
        if (timeB !== timeA) {
          return timeB - timeA;
        }
      }
      if (a.type !== b.type) {
        if (a.type === 'O') return -1;
        if (b.type === 'O') return 1;
      }
      return (a.display_name || a.name).localeCompare(b.display_name || b.name, 'ja');
    });
  }, [channels, filterText, selectedType, sortOrder, channelMembers]);

  const getChannelIcon = (type: string) => {
    switch (type) {
      case 'P':
        return <Lock className="w-3 h-3 text-amber-400 shrink-0" />;
      case 'D':
        return <User className="w-3 h-3 text-sky-400 shrink-0" />;
      case 'G':
        return <Users className="w-3 h-3 text-purple-400 shrink-0" />;
      default:
        return <Hash className="w-3 h-3 text-zinc-500 shrink-0" />;
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-xs"
        onClick={onClose}
      />

      <aside className="fixed inset-y-0 left-0 z-40 w-72 md:static md:w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col font-mono select-none safe-top safe-bottom">
        {/* Header */}
        <div className="p-2.5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-zinc-300 font-bold text-xs">
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            <span>チャンネル一覧</span>
            <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1 rounded">
              {filteredAndSortedChannels.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="md:hidden p-1 text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Catchup Button Banner (if unreads exist) */}
        {totalUnreadChannels > 0 && onOpenCatchup && (
          <div className="p-2 border-b border-emerald-900/50 bg-emerald-950/40">
            <button
              onClick={() => {
                onOpenCatchup();
                if (window.innerWidth < 768) onClose();
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors shadow-sm"
            >
              <div className="flex items-center space-x-1.5">
                <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                <span>未読キャッチアップ</span>
              </div>
              <span className="bg-emerald-800 px-1.5 py-0.2 rounded-full text-[10px]">
                {totalUnreadChannels}
              </span>
            </button>
          </div>
        )}

        {/* Search & Filter Bar */}
        <div className="p-2 space-y-1.5 border-b border-zinc-800/80 bg-zinc-900/40">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2 top-2" />
            <input
              type="text"
              placeholder="チャンネル / チーム検索..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded pl-7 pr-6 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
            />
            {filterText && (
              <button
                onClick={() => setFilterText('')}
                className="absolute right-2 top-1.5 text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Quick Filter tabs & Sort Toggle */}
          <div className="flex items-center justify-between text-[10px] pt-0.5">
            <div className="flex space-x-1">
              <button
                onClick={() => setSelectedType('ALL')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  selectedType === 'ALL'
                    ? 'bg-zinc-800 text-zinc-100 font-bold'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                全件
              </button>
              <button
                onClick={() => setSelectedType('UNREAD')}
                className={`px-1.5 py-0.5 rounded transition-colors flex items-center space-x-0.5 ${
                  selectedType === 'UNREAD'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold'
                    : totalUnreadChannels > 0
                    ? 'text-emerald-400 hover:text-emerald-300 font-semibold'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span>未読</span>
                {totalUnreadChannels > 0 && (
                  <span className="text-[9px] bg-emerald-900/80 text-emerald-200 px-1 rounded-full">
                    {totalUnreadChannels}
                  </span>
                )}
              </button>
              <button
                onClick={() => setSelectedType('CHANNELS')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  selectedType === 'CHANNELS'
                    ? 'bg-zinc-800 text-zinc-100 font-bold'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Ch
              </button>
              <button
                onClick={() => setSelectedType('DM')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  selectedType === 'DM'
                    ? 'bg-zinc-800 text-zinc-100 font-bold'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                DM
              </button>
            </div>

            {/* Sort Toggle Button */}
            <button
              onClick={() => onToggleSortOrder(sortOrder === 'recent' ? 'name' : 'recent')}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-300 transition-colors"
              title={sortOrder === 'recent' ? '最新更新順（クリックで名前順へ）' : '名前順（クリックで最新更新順へ）'}
            >
              {sortOrder === 'recent' ? (
                <>
                  <Clock className="w-2.5 h-2.5 text-emerald-400" />
                  <span>更新順</span>
                </>
              ) : (
                <>
                  <ArrowDownAZ className="w-2.5 h-2.5 text-sky-400" />
                  <span>名前順</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Flat Channel List */}
        <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
          {filteredAndSortedChannels.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500 italic">
              {channels.length === 0
                ? 'チャンネルがありません。設定からチームを選択してください。'
                : '一致するチャンネルがありません'}
            </div>
          ) : (
            filteredAndSortedChannels.map((ch) => {
              const isActive = ch.id === activeChannelId;
              const relativeTime = formatRelativeTime(ch.last_post_at);
              const unreadInfo = getUnreadInfo(ch);

              return (
                <button
                  key={ch.id}
                  onClick={() => {
                    onSelectChannel(ch);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded flex items-center space-x-1.5 transition-colors group ${
                    isActive
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 font-bold'
                      : unreadInfo.isUnread
                      ? 'text-zinc-100 font-bold hover:bg-zinc-900'
                      : 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100'
                  }`}
                >
                  {getChannelIcon(ch.type)}

                  {showTeamBadge && ch.team_display_name && (
                    <span
                      title={ch.team_display_name}
                      className={`text-[9px] px-1 py-0.2 rounded shrink-0 max-w-[60px] truncate border ${
                        isActive
                          ? 'bg-emerald-900/60 border-emerald-700 text-emerald-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 group-hover:border-zinc-700'
                      }`}
                    >
                      {ch.team_display_name}
                    </span>
                  )}

                  <span className="text-xs truncate flex-1 font-mono">
                    {ch.display_name || ch.name}
                  </span>

                  {/* Mention badge */}
                  {unreadInfo.mentionCount > 0 && (
                    <span className="text-[9px] bg-rose-950 border border-rose-700 text-rose-300 px-1 py-0.1 rounded-full font-bold shrink-0">
                      @{unreadInfo.mentionCount}
                    </span>
                  )}

                  {/* Unread count badge */}
                  {unreadInfo.isUnread && (
                    <span className="text-[9px] bg-emerald-900/80 border border-emerald-700/60 text-emerald-300 px-1 py-0.1 rounded-full font-bold shrink-0">
                      {unreadInfo.unreadCount}
                    </span>
                  )}

                  {relativeTime && (
                    <span className="text-[10px] text-zinc-600 shrink-0 font-normal">
                      {relativeTime}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
};

