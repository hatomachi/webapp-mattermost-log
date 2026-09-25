import React, { useState, useEffect } from 'react';
import { AppSettings, MattermostTeam, MattermostCustomEmoji } from '../types/mattermost';
import {
  getMe,
  getMyTeams,
  formatEmojiDisplay,
  searchCustomEmojis,
  getCustomEmojis,
  getEmojiImageUrl,
} from '../services/mattermost';
import { DEFAULT_FAVORITE_EMOJIS } from '../services/storage';
import {
  X,
  Check,
  AlertCircle,
  RefreshCw,
  Server,
  Key,
  Globe,
  Eye,
  ExternalLink,
  Bot,
  Cpu,
  Plus,
  RotateCcw,
  Search,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';
import { deriveHttpUrls, deriveWsUrl } from '../features/ai/useAiRemoteClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
}

const CustomEmojiThumbnail: React.FC<{
  serverUrl: string;
  token: string;
  emoji: MattermostCustomEmoji;
  corsProxy?: string;
}> = ({ serverUrl, token, emoji, corsProxy }) => {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getEmojiImageUrl(serverUrl, token, emoji.id, corsProxy)
      .then((url) => {
        if (isMounted) setImgUrl(url);
      })
      .catch(() => {
        if (isMounted) setHasError(true);
      });
    return () => {
      isMounted = false;
    };
  }, [serverUrl, token, emoji.id, corsProxy]);

  if (hasError) {
    return <span className="text-[10px] text-zinc-500 font-mono">:{emoji.name}:</span>;
  }

  if (!imgUrl) {
    return <span className="w-6 h-6 rounded bg-zinc-800 animate-pulse inline-block shrink-0" />;
  }

  return (
    <img
      src={imgUrl}
      alt={emoji.name}
      className="w-6 h-6 object-contain inline-block shrink-0"
      loading="lazy"
    />
  );
};

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [formData, setFormData] = useState<AppSettings>(settings);
  const [teams, setTeams] = useState<MattermostTeam[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const [isAiTesting, setIsAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const [newEmojiInput, setNewEmojiInput] = useState('');

  // カスタム絵文字画像検索用ステート
  const [customEmojiSearchTerm, setCustomEmojiSearchTerm] = useState('');
  const [searchedCustomEmojis, setSearchedCustomEmojis] = useState<MattermostCustomEmoji[]>([]);
  const [isSearchingEmojis, setIsSearchingEmojis] = useState(false);
  const [searchEmojiError, setSearchEmojiError] = useState<string | null>(null);
  const [hasSearchedEmojis, setHasSearchedEmojis] = useState(false);

  const currentFavoriteEmojis = formData.favoriteEmojis || DEFAULT_FAVORITE_EMOJIS;

  const handleAddFavoriteEmoji = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newEmojiInput.trim().replace(/^:+|:+$/g, '');
    if (!clean) return;
    if (!currentFavoriteEmojis.includes(clean)) {
      setFormData({
        ...formData,
        favoriteEmojis: [...currentFavoriteEmojis, clean],
      });
    }
    setNewEmojiInput('');
  };

  const handleRemoveFavoriteEmoji = (emojiName: string) => {
    setFormData({
      ...formData,
      favoriteEmojis: currentFavoriteEmojis.filter((e) => e !== emojiName),
    });
  };

  const handleToggleFavoriteCustomEmoji = (emojiName: string) => {
    if (currentFavoriteEmojis.includes(emojiName)) {
      handleRemoveFavoriteEmoji(emojiName);
    } else {
      setFormData({
        ...formData,
        favoriteEmojis: [...currentFavoriteEmojis, emojiName],
      });
    }
  };

  const handleResetFavoriteEmojis = () => {
    setFormData({
      ...formData,
      favoriteEmojis: DEFAULT_FAVORITE_EMOJIS,
    });
  };

  const handleSearchCustomEmojis = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.serverUrl || !formData.token) {
      setSearchEmojiError('サーバーURLとトークンが入力されていません');
      return;
    }

    setIsSearchingEmojis(true);
    setSearchEmojiError(null);
    setHasSearchedEmojis(true);

    try {
      let results: MattermostCustomEmoji[];
      const term = customEmojiSearchTerm.trim().replace(/^:+|:+$/g, '');
      if (term) {
        results = await searchCustomEmojis(
          formData.serverUrl,
          formData.token,
          term,
          formData.corsProxy
        );
      } else {
        results = await getCustomEmojis(
          formData.serverUrl,
          formData.token,
          0,
          32,
          formData.corsProxy
        );
      }
      setSearchedCustomEmojis(results);
    } catch (err: any) {
      setSearchEmojiError(err.message || 'カスタム絵文字の取得に失敗しました');
    } finally {
      setIsSearchingEmojis(false);
    }
  };

  const handleTestAiConnection = async () => {
    const hubUrl = (formData.aiHubUrl || 'ws://localhost:8090/ws/client').trim();
    const token = (formData.aiToken || '').trim();

    if (!token) {
      setAiTestResult({
        success: false,
        message: '認証トークン (Auth Key) が未入力です。社内PCで start-agent 起動時に表示された UUID を入力してください。',
      });
      return;
    }

    setIsAiTesting(true);
    setAiTestResult(null);

    const transportMode = formData.aiTransportMode || 'auto';

    // 1. HTTP メッセージエンドポイント (POST .../message?token=...) を試行 (社内プロキシ・スマホで確実に通る)
    if (transportMode === 'http' || transportMode === 'auto') {
      try {
        const { messageUrl } = deriveHttpUrls(hubUrl, token);
        const postRes = await fetch(messageUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'get_status' }),
          signal: AbortSignal.timeout(4000),
        });

        if (postRes.ok) {
          setAiTestResult({
            success: true,
            message: 'HTTP (SSE+POST) 接続成功: ✅ 社内PC Bridge Agent 接続中',
          });
          return;
        }

        if (postRes.status === 503) {
          setAiTestResult({
            success: true,
            message: 'HTTP (SSE+POST) 疎通成功: ⚠️ Relay Hub は到達可能ですが、PC側の start-agent が起動していません',
          });
          return;
        }

        if (postRes.status === 401) {
          setAiTestResult({
            success: false,
            message: '認証エラー (HTTP 401): 認証トークン (Auth Key) が正しくありません。PC側のログを確認してください',
          });
          return;
        }
      } catch (httpErr: any) {
        console.warn('HTTP POST test failed:', httpErr);
        if (transportMode === 'http') {
          setAiTestResult({
            success: false,
            message: `HTTP (SSE+POST) 接続失敗: ${httpErr.message || 'Hub にアクセスできません'}`,
          });
          return;
        }
      }
    }

    // 2. WebSocket での直接疎通確認
    try {
      const wsUrlStr = deriveWsUrl(hubUrl, token);
      const testWs = new WebSocket(wsUrlStr);

      const wsPromise = new Promise<{ success: boolean; message: string }>((resolve, reject) => {
        const timer = setTimeout(() => {
          testWs.close();
          reject(new Error('WebSocket 接続タイムアウト (3秒) - 社内プロキシ環境では通信方式を「HTTP」に設定してください'));
        }, 3000);

        testWs.onopen = () => {
          clearTimeout(timer);
          testWs.close();
          resolve({
            success: true,
            message: 'WebSocket 接続成功: Relay Hub と通信可能',
          });
        };

        testWs.onerror = () => {
          clearTimeout(timer);
          reject(new Error('WebSocket 接続失敗: 社内プロキシで遮断されている可能性があります。通信方式を「HTTP (SSE+POST)」に切り替えてください'));
        };
      });

      const res = await wsPromise;
      setAiTestResult(res);
    } catch (err: any) {
      setAiTestResult({
        success: false,
        message: `接続失敗: ${err.message || 'Relay Hub に接続できません。URLとTokenをご確認ください'}`,
      });
    } finally {
      setIsAiTesting(false);
    }
  };

  useEffect(() => {
    setFormData(settings);
    if (settings.serverUrl && settings.token) {
      loadTeams(settings.serverUrl, settings.token, settings.corsProxy);
    }
  }, [settings, isOpen]);

  const loadTeams = async (url: string, token: string, proxy?: string) => {
    try {
      const fetchedTeams = await getMyTeams(url, token, proxy);
      setTeams(fetchedTeams);
      // 初回で未選択の場合、全チームをデフォルト選択
      if (formData.selectedTeamIds.length === 0 && fetchedTeams.length > 0) {
        setFormData((prev) => ({
          ...prev,
          selectedTeamIds: fetchedTeams.map((t) => t.id),
        }));
      }
    } catch (e: any) {
      console.warn('Failed to load teams on init:', e);
    }
  };

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    if (!formData.serverUrl || !formData.token) {
      setTestResult({
        success: false,
        message: 'サーバーURLとPATを入力してください',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const me = await getMe(formData.serverUrl, formData.token, formData.corsProxy);
      const fetchedTeams = await getMyTeams(formData.serverUrl, formData.token, formData.corsProxy);
      setTeams(fetchedTeams);

      // 初回で未選択の場合、全チームを選択
      const newSelected =
        formData.selectedTeamIds.length === 0
          ? fetchedTeams.map((t) => t.id)
          : formData.selectedTeamIds.filter((id) =>
              fetchedTeams.some((t) => t.id === id)
            );

      setFormData((prev) => ({
        ...prev,
        selectedTeamIds: newSelected.length > 0 ? newSelected : fetchedTeams.map((t) => t.id),
      }));

      setTestResult({
        success: true,
        message: `接続成功: @${me.username} (${fetchedTeams.length}個のチームを検出)`,
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || '接続に失敗しました',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const toggleTeam = (teamId: string) => {
    setFormData((prev) => {
      const exists = prev.selectedTeamIds.includes(teamId);
      const updated = exists
        ? prev.selectedTeamIds.filter((id) => id !== teamId)
        : [...prev.selectedTeamIds, teamId];
      return { ...prev, selectedTeamIds: updated };
    });
  };

  const selectAllTeams = () => {
    setFormData((prev) => ({
      ...prev,
      selectedTeamIds: teams.map((t) => t.id),
    }));
  };

  const deselectAllTeams = () => {
    setFormData((prev) => ({
      ...prev,
      selectedTeamIds: [],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-wider font-mono">
              接続 & 表示設定
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-200 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-mono">
          {/* Server URL */}
          <div>
            <label className="flex items-center space-x-1.5 text-zinc-300 font-semibold mb-1">
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              <span>Mattermost サーバー URL</span>
            </label>
            <input
              type="url"
              required
              placeholder="https://mattermost.example.com"
              value={formData.serverUrl}
              onChange={(e) =>
                setFormData({ ...formData, serverUrl: e.target.value })
              }
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[10px] text-zinc-500 mt-1">
              末尾のスラッシュは自動削除されます
            </p>
          </div>

          {/* PAT */}
          <div>
            <label className="flex items-center space-x-1.5 text-zinc-300 font-semibold mb-1">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>Personal Access Token (PAT)</span>
            </label>
            <input
              type="password"
              required
              placeholder="トークン文字列"
              value={formData.token}
              onChange={(e) =>
                setFormData({ ...formData, token: e.target.value })
              }
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[10px] text-zinc-500 mt-1">
              Mattermostのアカウント設定 &gt; セキュリティ &gt; 個人用アクセストークンで発行
            </p>
          </div>

          {/* CORS Proxy (Optional) */}
          <div>
            <label className="flex items-center space-x-1.5 text-zinc-400 font-semibold mb-1">
              <Globe className="w-3.5 h-3.5 text-zinc-500" />
              <span>CORS回避プロキシ URL（オプション）</span>
            </label>
            <input
              type="text"
              placeholder="例: https://cors-proxy.internal.net/{url}"
              value={formData.corsProxy || ''}
              onChange={(e) =>
                setFormData({ ...formData, corsProxy: e.target.value })
              }
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-zinc-500"
            />
            <p className="text-[10px] text-zinc-500 mt-1">
              ブラウザから直接 Mattermost に CORS 接続できない場合のみ指定します
            </p>
          </div>

          {/* Direct Link Mattermost URL (Optional) */}
          <div>
            <label className="flex items-center space-x-1.5 text-zinc-400 font-semibold mb-1">
              <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
              <span>直接リンク用 Mattermost URL（オプション）</span>
            </label>
            <input
              type="text"
              placeholder="例: https://mattermost.example.com（未指定時はサーバーURLを使用）"
              value={formData.webUrl || ''}
              onChange={(e) =>
                setFormData({ ...formData, webUrl: e.target.value })
              }
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-zinc-500"
            />
            <p className="text-[10px] text-zinc-500 mt-1">
              チャンネルリンクからブラウザで開くMattermostのベースURLです。API接続用URLと異なる場合のみ指定します
            </p>
          </div>

          {/* Test & Fetch Teams Button */}
          <div className="pt-1">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="w-full flex items-center justify-center space-x-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-1.5 px-3 rounded border border-zinc-600 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`}
              />
              <span>{isTesting ? '接続テスト中...' : '接続テスト & チーム取得'}</span>
            </button>

            {testResult && (
              <div
                className={`mt-2 p-2 rounded text-[11px] flex items-start space-x-1.5 ${
                  testResult.success
                    ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/60 border border-rose-800 text-rose-300'
                }`}
              >
                {testResult.success ? (
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-400" />
                )}
                <span className="break-all">{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Team Selection */}
          <div className="border-t border-zinc-800 pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-zinc-300 font-semibold">
                表示対象チームの選択
              </label>
              {teams.length > 0 && (
                <div className="space-x-2 text-[10px]">
                  <button
                    type="button"
                    onClick={selectAllTeams}
                    className="text-sky-400 hover:underline"
                  >
                    全選択
                  </button>
                  <span className="text-zinc-600">|</span>
                  <button
                    type="button"
                    onClick={deselectAllTeams}
                    className="text-zinc-400 hover:underline"
                  >
                    解除
                  </button>
                </div>
              )}
            </div>

            {teams.length === 0 ? (
              <p className="text-[11px] text-zinc-500 py-2 italic bg-zinc-950 p-2.5 rounded border border-zinc-800 text-center">
                上記の「接続テスト & チーム取得」を押すとチーム一覧が表示されます
              </p>
            ) : (
              <div className="max-h-36 overflow-y-auto space-y-1 bg-zinc-950 p-2 rounded border border-zinc-800">
                {teams.map((team) => {
                  const isChecked = formData.selectedTeamIds.includes(team.id);
                  return (
                    <label
                      key={team.id}
                      className={`flex items-center space-x-2 p-1.5 rounded cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-zinc-800/80 text-zinc-100'
                          : 'text-zinc-400 hover:bg-zinc-900'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleTeam(team.id)}
                        className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
                      />
                      <span className="font-medium truncate">
                        {team.display_name || team.name}
                      </span>
                      <span className="text-[10px] text-zinc-500 ml-auto">
                        @{team.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* View Options */}
          <div className="border-t border-zinc-800 pt-3 space-y-2.5">
            <div className="flex items-center space-x-1.5 text-zinc-300 font-semibold">
              <Eye className="w-3.5 h-3.5 text-purple-400" />
              <span>ログ表示オプション</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="flex items-center space-x-2 cursor-pointer bg-zinc-950 p-2 rounded border border-zinc-800">
                <input
                  type="checkbox"
                  checked={formData.showSeconds}
                  onChange={(e) =>
                    setFormData({ ...formData, showSeconds: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
                />
                <span className="text-zinc-300">秒まで表示 (:ss)</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer bg-zinc-950 p-2 rounded border border-zinc-800">
                <input
                  type="checkbox"
                  checked={formData.showTeamBadge}
                  onChange={(e) =>
                    setFormData({ ...formData, showTeamBadge: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
                />
                <span className="text-zinc-300">チームバッジ表示</span>
              </label>

              <label className="col-span-2 flex items-center space-x-2 cursor-pointer bg-zinc-950 p-2 rounded border border-zinc-800">
                <input
                  type="checkbox"
                  checked={formData.collapseNewlines}
                  onChange={(e) =>
                    setFormData({ ...formData, collapseNewlines: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
                />
                <div>
                  <span className="text-zinc-300">改行を無視して表示（高密度・全体俯瞰）</span>
                  <p className="text-[10px] text-zinc-500">ポスト内の改行を半角スペースに置き換え、ログをコンパクトに一覧表示します</p>
                </div>
              </label>

              <label className="col-span-2 flex items-center space-x-2 cursor-pointer bg-zinc-950 p-2 rounded border border-zinc-800">
                <input
                  type="checkbox"
                  checked={formData.showReactions}
                  onChange={(e) =>
                    setFormData({ ...formData, showReactions: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
                />
                <div>
                  <span className="text-zinc-300">スタンプ（リアクション）を表示</span>
                  <p className="text-[10px] text-zinc-500">メッセージ末尾にスタンプと件数をインライン表示します（カスタム絵文字はテキスト表示）</p>
                </div>
              </label>

              {/* お気に入りスタンプ設定 */}
              <div className="col-span-2 bg-zinc-950 p-2.5 rounded border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-zinc-300 text-xs font-semibold">お気に入りスタンプ（クイックパレット）</span>
                    <p className="text-[10px] text-zinc-500">スタンプ選択時に1タップで押せるスタンプです。社内のカスタム名も追加できます</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetFavoriteEmojis}
                    className="flex items-center space-x-1 text-[10px] text-zinc-400 hover:text-zinc-200 px-1.5 py-0.5 rounded border border-zinc-800 hover:border-zinc-700"
                    title="デフォルトの定番スタンプに戻す"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>初期値に戻す</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {currentFavoriteEmojis.map((emojiName) => {
                    const { display, isUnicode } = formatEmojiDisplay(emojiName);
                    return (
                      <span
                        key={emojiName}
                        className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200"
                      >
                        <span className={isUnicode ? 'text-sm leading-none' : 'text-[11px] text-sky-300 font-mono'}>
                          {display}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFavoriteEmoji(emojiName)}
                          className="text-zinc-500 hover:text-rose-400 ml-0.5 transition-colors"
                          title="削除"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>

                <div className="flex items-center space-x-1.5 pt-1">
                  <input
                    type="text"
                    value={newEmojiInput}
                    onChange={(e) => setNewEmojiInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddFavoriteEmoji(e);
                      }
                    }}
                    placeholder="絵文字名 (例: thumbsup, arigato, 承知)"
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddFavoriteEmoji}
                    disabled={!newEmojiInput.trim()}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-2.5 py-1 rounded text-xs flex items-center space-x-1 font-semibold transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>追加</span>
                  </button>
                </div>

                {/* 社内カスタムスタンプ検索（実画像プレビュー＆ワンタップお気に入り追加） */}
                <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-zinc-300">
                      <ImageIcon className="w-3.5 h-3.5 text-sky-400" />
                      <span className="text-xs font-semibold">カスタムスタンプ検索（実画像プレビュー）</span>
                    </div>
                    <span className="text-[10px] text-zinc-500">クリックでお気に入りに追加/解除</span>
                  </div>

                  <form onSubmit={handleSearchCustomEmojis} className="flex items-center space-x-1.5">
                    <input
                      type="text"
                      value={customEmojiSearchTerm}
                      onChange={(e) => setCustomEmojiSearchTerm(e.target.value)}
                      placeholder="スタンプ名を検索 (空欄で一覧取得, 例: otsukare)"
                      className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-sky-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleSearchCustomEmojis}
                      disabled={isSearchingEmojis}
                      className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white px-3 py-1 rounded text-xs flex items-center space-x-1 font-semibold transition-colors shrink-0"
                    >
                      {isSearchingEmojis ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Search className="w-3 h-3" />
                      )}
                      <span>{isSearchingEmojis ? '検索中' : '探す'}</span>
                    </button>
                  </form>

                  {/* エラー表示 */}
                  {searchEmojiError && (
                    <div className="p-1.5 text-[10px] text-rose-400 bg-rose-950/40 border border-rose-800 rounded">
                      {searchEmojiError}
                    </div>
                  )}

                  {/* 検索結果グリッド */}
                  {hasSearchedEmojis && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400">
                        <span>検出: {searchedCustomEmojis.length} 件</span>
                        {searchedCustomEmojis.length > 0 && (
                          <span className="text-zinc-500">※画像をクリックしてお気に入り登録</span>
                        )}
                      </div>

                      {searchedCustomEmojis.length === 0 ? (
                        <div className="p-3 text-center text-zinc-500 text-xs bg-zinc-900/50 rounded border border-zinc-800">
                          該当するカスタムスタンプが見つかりませんでした
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 max-h-52 overflow-y-auto p-1 bg-zinc-900/40 rounded border border-zinc-800/80">
                          {searchedCustomEmojis.map((emoji) => {
                            const isFav = currentFavoriteEmojis.includes(emoji.name);
                            return (
                              <button
                                key={emoji.id}
                                type="button"
                                onClick={() => handleToggleFavoriteCustomEmoji(emoji.name)}
                                className={`flex items-center space-x-1.5 p-1 rounded border text-left transition-all cursor-pointer ${
                                  isFav
                                    ? 'bg-sky-950/80 border-sky-600 text-sky-200'
                                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                                }`}
                                title={isFav ? `:${emoji.name}: (お気に入り解除)` : `:${emoji.name}: (お気に入りに追加)`}
                              >
                                <CustomEmojiThumbnail
                                  serverUrl={formData.serverUrl}
                                  token={formData.token}
                                  emoji={emoji}
                                  corsProxy={formData.corsProxy}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-[10px] font-mono truncate leading-tight">
                                    :{emoji.name}:
                                  </div>
                                  <div className="text-[9px] leading-none mt-0.5">
                                    {isFav ? (
                                      <span className="text-sky-400 font-semibold">✓ 登録済</span>
                                    ) : (
                                      <span className="text-zinc-500 hover:text-zinc-400">＋ 追加</span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {!hasSearchedEmojis && (
                    <div className="text-[10px] text-zinc-500 bg-zinc-900/30 p-2 rounded border border-zinc-850">
                      💡 「探す」を押すと社内のカスタムスタンプ（実画像アイコン付き）を検索し、ワンタップでお気に入りに追加できます。
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] bg-zinc-950 p-2 rounded border border-zinc-800">
              <span className="text-zinc-300">文字サイズ</span>
              <div className="flex space-x-1">
                {(['xs', 'sm', 'base'] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setFormData({ ...formData, fontSize: size })}
                    className={`px-2 py-0.5 rounded text-[10px] ${
                      formData.fontSize === size
                        ? 'bg-emerald-600 text-white font-bold'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {size.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] bg-zinc-950 p-2 rounded border border-zinc-800">
              <span className="text-zinc-300">チャンネル並び順</span>
              <div className="flex space-x-1">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, channelSortOrder: 'recent' })}
                  className={`px-2 py-0.5 rounded text-[10px] ${
                    formData.channelSortOrder === 'recent'
                      ? 'bg-emerald-600 text-white font-bold'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  更新順
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, channelSortOrder: 'name' })}
                  className={`px-2 py-0.5 rounded text-[10px] ${
                    formData.channelSortOrder === 'name'
                      ? 'bg-emerald-600 text-white font-bold'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  名前順
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] bg-zinc-950 p-2 rounded border border-zinc-800">
              <span className="text-zinc-300">自動更新間隔</span>
              <select
                value={formData.autoRefreshInterval}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    autoRefreshInterval: Number(e.target.value),
                  })
                }
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-zinc-200 text-[10px] focus:outline-none"
              >
                <option value={0}>無効 (手動のみ)</option>
                <option value={15}>15秒</option>
                <option value={30}>30秒 (推奨)</option>
                <option value={60}>60秒</option>
              </select>
            </div>
          </div>

          {/* AI Remote Hub Settings */}
          <div className="border-t border-zinc-800 pt-3 space-y-2.5">
            <div className="flex items-center space-x-1.5 text-zinc-300 font-semibold">
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
              <span>AI Remote 連携 (社内PC Bridge Agent 接続)</span>
            </div>

            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                Relay Hub URL (WSS / WS)
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="ws://localhost:8090/ws/client または wss://..."
                  value={formData.aiHubUrl || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, aiHubUrl: e.target.value })
                  }
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-zinc-500 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={handleTestAiConnection}
                  disabled={isAiTesting}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded border border-zinc-600 transition-colors text-xs shrink-0 flex items-center space-x-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isAiTesting ? 'animate-spin' : ''}`} />
                  <span>テスト</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-zinc-300 font-semibold mb-1 flex items-center space-x-1">
                <Key className="w-3 h-3 text-emerald-400" />
                <span>認証トークン / Auth Key (Session Token)</span>
              </label>
              <input
                type="text"
                placeholder="例: 550e8400-e29b-41d4-a716-446655440000"
                value={formData.aiToken || ''}
                onChange={(e) =>
                  setFormData({ ...formData, aiToken: e.target.value })
                }
                className="w-full bg-zinc-950 border border-zinc-700/80 rounded px-2.5 py-1.5 text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-emerald-500 text-xs font-mono"
              />
              <p className="text-[10px] text-zinc-500 mt-0.5">
                社内PCで start-agent を起動した際に表示される UUID (Session Token) を入力してください
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  AI Engine
                </label>
                <select
                  value={formData.aiEngine || 'claude'}
                  onChange={(e) =>
                    setFormData({ ...formData, aiEngine: e.target.value as 'claude' | 'copilot' })
                  }
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200 text-xs focus:outline-none"
                >
                  <option value="claude">Claude Code (標準)</option>
                  <option value="copilot">GitHub Copilot CLI</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Model
                </label>
                <input
                  type="text"
                  placeholder="claude-opus-4-7"
                  value={formData.aiModel || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, aiModel: e.target.value })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-zinc-500 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-zinc-300 font-semibold mb-1 flex items-center justify-between">
                <span>通信方式 (Transport Mode)</span>
                <span className="text-[10px] text-emerald-400 font-normal">社内プロキシ・スマホ対応</span>
              </label>
              <select
                value={formData.aiTransportMode || 'auto'}
                onChange={(e) =>
                  setFormData({ ...formData, aiTransportMode: e.target.value as 'auto' | 'http' | 'ws' })
                }
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="auto">自動 (WebSocket 優先 / 遮断時 HTTP フォールバック)</option>
                <option value="http">HTTP (SSE + POST) ※社内プロキシ・スマホ推奨</option>
                <option value="ws">WebSocket (常時双方向)</option>
              </select>
              <p className="text-[10px] text-zinc-500 mt-0.5">
                社内プロキシやZTNAでWebSocketが弾かれる環境では「HTTP (SSE + POST)」を選択してください
              </p>
            </div>

            <p className="text-[10px] text-zinc-500">
              社内PCで <code>webapp-ai-remote</code> の <code>start-agent</code> を起動しておくと、会社スマホ(PWA)から電車内でも社内PCのClaude/Copilotと対話できます
            </p>

            {aiTestResult && (
              <div
                className={`p-2 rounded text-[11px] flex items-start space-x-1.5 ${
                  aiTestResult.success
                    ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/60 border border-rose-800 text-rose-300'
                }`}
              >
                {aiTestResult.success ? (
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-400" />
                )}
                <span className="break-all">{aiTestResult.message}</span>
              </div>
            )}
          </div>

          {/* Footer Save */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded text-xs transition-colors shadow-lg shadow-emerald-950 flex items-center justify-center space-x-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>設定を保存して適用</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
