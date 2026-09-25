import { AppSettings, ChannelSubscriptionMode, MattermostChannelMember, MattermostUser } from '../types/mattermost';

const SETTINGS_KEY = 'matterlog_settings';
const USER_CACHE_KEY = 'matterlog_user_cache';
const ACTIVE_CHANNEL_KEY = 'matterlog_active_channel_id';
const CHANNEL_SUBSCRIPTION_KEY = 'matterlog_channel_subscriptions';

export const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: '',
  token: '',
  selectedTeamIds: [],
  corsProxy: '',
  webUrl: '',
  showSeconds: true,
  showTeamBadge: true,
  showReactions: false,
  autoRefreshInterval: 30,
  fontSize: 'xs',
  channelSortOrder: 'recent',
  collapseNewlines: false,
  aiAgentUrl: 'http://localhost:3456',
  aiHubUrl: 'ws://localhost:8090/ws/client',
  aiToken: '',
  aiEngine: 'claude',
  aiModel: 'claude-opus-4-7',
  aiTransportMode: 'auto',
};

export const loadSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const settings = { ...DEFAULT_SETTINGS, ...parsed };

    // webapp-ai-remote (ai_remote_settings_v1) が同一オリジン/ブラウザに存在する場合は自動引き継ぎ
    if (!settings.aiToken) {
      try {
        const remoteRaw = localStorage.getItem('ai_remote_settings_v1');
        if (remoteRaw) {
          const remoteParsed = JSON.parse(remoteRaw);
          if (remoteParsed.hubUrl && !parsed.aiHubUrl) settings.aiHubUrl = remoteParsed.hubUrl;
          if (remoteParsed.authToken) settings.aiToken = remoteParsed.authToken;
        }
      } catch {}
    }

    // URLクエリパラメータ (?ai_token=xxxx や ?ai_hub=xxxx) による自動セット
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const urlAiToken = params.get('ai_token') || params.get('ai_key');
        const urlAiHub = params.get('ai_hub');
        let hasUrlChange = false;

        if (urlAiToken && urlAiToken.trim()) {
          settings.aiToken = urlAiToken.trim();
          hasUrlChange = true;
        }
        if (urlAiHub && urlAiHub.trim()) {
          settings.aiHubUrl = urlAiHub.trim();
          hasUrlChange = true;
        }
        if (hasUrlChange) {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        }
      } catch {}
    }

    return settings;
  } catch (e) {
    console.error('Failed to load settings:', e);
    return DEFAULT_SETTINGS;
  }
};

export const saveSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
};

export const loadActiveChannelId = (): string => {
  return localStorage.getItem(ACTIVE_CHANNEL_KEY) || '';
};

export const saveActiveChannelId = (channelId: string): void => {
  localStorage.setItem(ACTIVE_CHANNEL_KEY, channelId);
};

export const loadUserCache = (): Record<string, MattermostUser> => {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export const saveUserCache = (cache: Record<string, MattermostUser>): void => {
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error('Failed to save user cache:', e);
  }
};

export const loadChannelSubscriptions = (): Record<string, ChannelSubscriptionMode> => {
  try {
    const raw = localStorage.getItem(CHANNEL_SUBSCRIPTION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export const saveChannelSubscriptions = (subs: Record<string, ChannelSubscriptionMode>): void => {
  try {
    localStorage.setItem(CHANNEL_SUBSCRIPTION_KEY, JSON.stringify(subs));
  } catch (e) {
    console.error('Failed to save channel subscriptions:', e);
  }
};

/**
 * チャンネルの購読モードを取得する。
 * 1. 本アプリの保存設定があればそれを最優先
 * 2. なければ Mattermost の notify_props?.mark_unread === 'mention'（公式のミュート）をデフォルトでメンション扱いにする
 * 3. いずれでもなければ 'all'（通常）
 */
export const getEffectiveChannelSubscription = (
  channelId: string,
  member?: MattermostChannelMember,
  savedSubscriptions: Record<string, ChannelSubscriptionMode> = {}
): ChannelSubscriptionMode => {
  if (savedSubscriptions[channelId]) {
    return savedSubscriptions[channelId];
  }
  if (member?.notify_props?.mark_unread === 'mention') {
    return 'mention';
  }
  return 'all';
};
