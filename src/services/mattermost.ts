import {
  MattermostChannel,
  MattermostPost,
  MattermostPostListResponse,
  MattermostTeam,
  MattermostUser,
} from '../types/mattermost';

export class MattermostApiError extends Error {
  status?: number;
  isCors?: boolean;

  constructor(message: string, status?: number, isCors?: boolean) {
    super(message);
    this.name = 'MattermostApiError';
    this.status = status;
    this.isCors = isCors;
  }
}

const buildUrl = (serverUrl: string, path: string, corsProxy?: string): string => {
  let base = serverUrl.trim().replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const fullTarget = `${base}${cleanPath}`;

  if (corsProxy && corsProxy.trim() !== '') {
    const proxyBase = corsProxy.trim().replace(/\/+$/, '');
    if (proxyBase.includes('{url}')) {
      return proxyBase.replace('{url}', encodeURIComponent(fullTarget));
    }
    return `${proxyBase}/${fullTarget}`;
  }

  return fullTarget;
};

const request = async <T>(
  serverUrl: string,
  token: string,
  path: string,
  options: RequestInit = {},
  corsProxy?: string
): Promise<T> => {
  if (!serverUrl || !token) {
    throw new MattermostApiError('サーバーURLとトークンが設定されていません');
  }

  const url = buildUrl(serverUrl, path, corsProxy);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.trim()}`,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      let errorMsg = `HTTP Error ${res.status}: ${res.statusText}`;
      try {
        const errorJson = await res.json();
        if (errorJson.message) {
          errorMsg = errorJson.message;
        }
      } catch {
        // ignore json parse error
      }
      throw new MattermostApiError(errorMsg, res.status);
    }

    return (await res.json()) as T;
  } catch (err: any) {
    if (err instanceof MattermostApiError) {
      throw err;
    }
    // Failed to fetch is typically CORS or network unreachable
    const isNetworkOrCors = err.message === 'Failed to fetch' || err.name === 'TypeError';
    throw new MattermostApiError(
      isNetworkOrCors
        ? '通信エラーまたはCORS制限により接続できませんでした。サーバーURLを確認するか、プロキシ設定を検討してください。'
        : err.message,
      undefined,
      isNetworkOrCors
    );
  }
};

export const getMe = async (
  serverUrl: string,
  token: string,
  corsProxy?: string
): Promise<MattermostUser> => {
  return request<MattermostUser>(serverUrl, token, '/api/v4/users/me', {}, corsProxy);
};

export const getMyTeams = async (
  serverUrl: string,
  token: string,
  corsProxy?: string
): Promise<MattermostTeam[]> => {
  return request<MattermostTeam[]>(serverUrl, token, '/api/v4/users/me/teams', {}, corsProxy);
};

export const getTeamChannels = async (
  serverUrl: string,
  token: string,
  teamId: string,
  corsProxy?: string
): Promise<MattermostChannel[]> => {
  return request<MattermostChannel[]>(
    serverUrl,
    token,
    `/api/v4/users/me/teams/${teamId}/channels`,
    {},
    corsProxy
  );
};

export const getChannelPosts = async (
  serverUrl: string,
  token: string,
  channelId: string,
  page: number = 0,
  perPage: number = 60,
  corsProxy?: string
): Promise<MattermostPostListResponse> => {
  return request<MattermostPostListResponse>(
    serverUrl,
    token,
    `/api/v4/channels/${channelId}/posts?page=${page}&per_page=${perPage}`,
    {},
    corsProxy
  );
};

export const getUsersByIds = async (
  serverUrl: string,
  token: string,
  userIds: string[],
  corsProxy?: string
): Promise<MattermostUser[]> => {
  if (userIds.length === 0) return [];
  // Mattermost POST /api/v4/users/ids
  return request<MattermostUser[]>(
    serverUrl,
    token,
    '/api/v4/users/ids',
    {
      method: 'POST',
      body: JSON.stringify(userIds),
    },
    corsProxy
  );
};

/**
 * ユーザーの表示名（日本語名、ニックネーム、ユーザー名）を決定する
 * 優先順: ニックネーム > 姓 名 > 姓 > 名 > ユーザー名
 */
export const formatUserDisplayName = (
  user?: MattermostUser,
  fallbackUsername?: string
): string => {
  if (!user) return fallbackUsername || '不明';

  if (user.nickname && user.nickname.trim() !== '') {
    return user.nickname.trim();
  }

  const hasLast = Boolean(user.last_name && user.last_name.trim());
  const hasFirst = Boolean(user.first_name && user.first_name.trim());

  if (hasLast && hasFirst) {
    return `${user.last_name.trim()} ${user.first_name.trim()}`;
  }
  if (hasLast) return user.last_name.trim();
  if (hasFirst) return user.first_name.trim();

  return user.username || fallbackUsername || '不明';
};
