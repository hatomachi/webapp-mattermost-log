import React, { useState, useMemo } from 'react';
import { MattermostChannel } from '../types/mattermost';
import { Search, Hash, Lock, User, Users, X, Layers } from 'lucide-react';

interface Props {
  isOpen: boolean;
  channels: MattermostChannel[];
  activeChannelId: string;
  onSelectChannel: (channel: MattermostChannel) => void;
  onClose: () => void;
  showTeamBadge: boolean;
}

export const ChannelSidebar: React.FC<Props> = ({
  isOpen,
  channels,
  activeChannelId,
  onSelectChannel,
  onClose,
  showTeamBadge,
}) => {
  const [filterText, setFilterText] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');

  const filteredChannels = useMemo(() => {
    return channels.filter((ch) => {
      // Type filter
      if (selectedType !== 'ALL') {
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
  }, [channels, filterText, selectedType]);

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
              {filteredChannels.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="md:hidden p-1 text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

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

          {/* Quick Filter tabs */}
          <div className="flex space-x-1 text-[10px]">
            <button
              onClick={() => setSelectedType('ALL')}
              className={`px-2 py-0.5 rounded transition-colors ${
                selectedType === 'ALL'
                  ? 'bg-zinc-800 text-zinc-100 font-bold'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              全件
            </button>
            <button
              onClick={() => setSelectedType('CHANNELS')}
              className={`px-2 py-0.5 rounded transition-colors ${
                selectedType === 'CHANNELS'
                  ? 'bg-zinc-800 text-zinc-100 font-bold'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              チャンネル
            </button>
            <button
              onClick={() => setSelectedType('DM')}
              className={`px-2 py-0.5 rounded transition-colors ${
                selectedType === 'DM'
                  ? 'bg-zinc-800 text-zinc-100 font-bold'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              DM / グループ
            </button>
          </div>
        </div>

        {/* Flat Channel List */}
        <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
          {filteredChannels.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500 italic">
              {channels.length === 0
                ? 'チャンネルがありません。設定からチームを選択してください。'
                : '一致するチャンネルがありません'}
            </div>
          ) : (
            filteredChannels.map((ch) => {
              const isActive = ch.id === activeChannelId;
              return (
                <button
                  key={ch.id}
                  onClick={() => {
                    onSelectChannel(ch);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded flex items-center space-x-1.5 transition-colors group ${
                    isActive
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 font-bold'
                      : 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100'
                  }`}
                >
                  {getChannelIcon(ch.type)}

                  {showTeamBadge && ch.team_display_name && (
                    <span
                      title={ch.team_display_name}
                      className={`text-[9px] px-1 py-0.2 rounded shrink-0 max-w-[65px] truncate border ${
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
                </button>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
};
