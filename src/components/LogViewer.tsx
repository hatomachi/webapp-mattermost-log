import React, { useEffect, useRef, useState } from 'react';
import { MattermostPost, MattermostUser } from '../types/mattermost';
import { formatUserDisplayName } from '../services/mattermost';
import { ArrowDown, CornerDownRight } from 'lucide-react';

interface Props {
  posts: MattermostPost[];
  userCache: Record<string, MattermostUser>;
  showSeconds: boolean;
  fontSize: 'xs' | 'sm' | 'base';
  isLoading: boolean;
  channelName?: string;
}

export const LogViewer: React.FC<Props> = ({
  posts,
  userCache,
  showSeconds,
  fontSize,
  isLoading,
  channelName,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});

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

  const formatDateLabel = (timestamp: number) => {
    const d = new Date(timestamp);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return `${y}/${m}/${day} (${days[d.getDay()]})`;
  };

  const chronologicalPosts = [...posts].sort((a, b) => a.create_at - b.create_at);

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

  useEffect(() => {
    scrollToBottom(false);
  }, [channelName]);

  useEffect(() => {
    if (!showScrollBottom) {
      scrollToBottom(false);
    }
  }, [posts.length]);

  const toggleThread = (postId: string) => {
    setExpandedThreads((prev) => ({
      ...prev,
      [postId]: !prev[postId],
    }));
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
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto px-2.5 py-2 select-text ${fontClass}`}
      >
        {chronologicalPosts.map((post) => {
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

              <div className="group py-0.5 px-1 hover:bg-zinc-900/60 rounded flex items-start space-x-1.5 transition-colors">
                <span className="text-zinc-600 shrink-0 text-[11px] select-none font-mono tracking-tight">
                  [{formatTime(post.create_at)}]
                </span>

                <div className="flex-1 min-w-0 break-words whitespace-pre-wrap">
                  {isSystemMessage ? (
                    <span className="text-zinc-500 italic text-[11px]">
                      * {displayName} {post.message}
                    </span>
                  ) : (
                    <>
                      <span className={`font-semibold shrink-0 mr-1.5 select-text ${userColor}`}>
                        {displayName}:
                      </span>
                      <span className="text-zinc-200 selection:bg-emerald-950 selection:text-emerald-200">
                        {post.message}
                      </span>

                      {replyCount > 0 && (
                        <button
                          onClick={() => toggleThread(post.id)}
                          className="inline-flex items-center space-x-0.5 ml-2 text-[10px] bg-zinc-800/80 hover:bg-zinc-800 text-sky-400 px-1 rounded border border-zinc-700 select-none align-baseline cursor-pointer"
                        >
                          <CornerDownRight className="w-2.5 h-2.5" />
                          <span>返信{replyCount}件</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
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
