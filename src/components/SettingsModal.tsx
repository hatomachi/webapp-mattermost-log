import React, { useState, useEffect } from 'react';
import { AppSettings, MattermostTeam } from '../types/mattermost';
import { getMe, getMyTeams } from '../services/mattermost';
import { X, Check, AlertCircle, RefreshCw, Server, Key, Globe, Eye } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
}

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
