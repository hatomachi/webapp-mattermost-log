import { AppSettings, MattermostUser } from '../types/mattermost';

const SETTINGS_KEY = 'matterlog_settings';
const USER_CACHE_KEY = 'matterlog_user_cache';
const ACTIVE_CHANNEL_KEY = 'matterlog_active_channel_id';

export const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: '',
  token: '',
  selectedTeamIds: [],
  corsProxy: '',
  showSeconds: true,
  showTeamBadge: true,
  showReactions: false,
  autoRefreshInterval: 30,
  fontSize: 'xs',
  channelSortOrder: 'recent',
  collapseNewlines: false,
};


export const loadSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
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
