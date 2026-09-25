import {
  MattermostChannel,
  MattermostChannelMember,
  MattermostPost,
  MattermostPostListResponse,
  MattermostReaction,
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

export const getTeamChannelMembers = async (
  serverUrl: string,
  token: string,
  teamId: string,
  corsProxy?: string
): Promise<MattermostChannelMember[]> => {
  return request<MattermostChannelMember[]>(
    serverUrl,
    token,
    `/api/v4/users/me/teams/${teamId}/channels/members`,
    {},
    corsProxy
  );
};

export const viewChannel = async (
  serverUrl: string,
  token: string,
  channelId: string,
  prevChannelId: string = '',
  corsProxy?: string
): Promise<{ status: string }> => {
  return request<{ status: string }>(
    serverUrl,
    token,
    '/api/v4/channels/members/me/view',
    {
      method: 'POST',
      body: JSON.stringify({
        channel_id: channelId,
        prev_channel_id: prevChannelId,
      }),
    },
    corsProxy
  );
};

export const getChannelPosts = async (
  serverUrl: string,
  token: string,
  channelId: string,
  page: number = 0,
  perPage: number = 60,
  before?: string,
  corsProxy?: string,
  since?: number
): Promise<MattermostPostListResponse> => {
  const queryParams = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });
  if (before) {
    queryParams.set('before', before);
  }
  if (since !== undefined && since > 0) {
    queryParams.set('since', String(since));
  }
  return request<MattermostPostListResponse>(
    serverUrl,
    token,
    `/api/v4/channels/${channelId}/posts?${queryParams.toString()}`,
    {},
    corsProxy
  );
};

export const getPostThread = async (
  serverUrl: string,
  token: string,
  postId: string,
  corsProxy?: string
): Promise<MattermostPostListResponse> => {
  return request<MattermostPostListResponse>(
    serverUrl,
    token,
    `/api/v4/posts/${postId}/thread`,
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
 * 添付ファイルのBlobURLを取得（認証ヘッダー付きでフェッチ）
 */
export const fetchFileBlobUrl = async (
  serverUrl: string,
  token: string,
  fileId: string,
  thumbnail: boolean = false,
  corsProxy?: string
): Promise<string> => {
  const path = thumbnail ? `/api/v4/files/${fileId}/thumbnail` : `/api/v4/files/${fileId}`;
  const url = buildUrl(serverUrl, path, corsProxy);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.trim()}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to load file: ${res.statusText}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
};

/**
 * ファイルサイズを人間が読みやすい形式に変換
 */
export const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

export interface GroupedReaction {
  name: string;
  count: number;
  users: string[];
}

export const COMMON_EMOJI_MAP: Record<string, string> = {
  '+1': '👍',
  'thumbsup': '👍',
  '-1': '👎',
  'thumbsdown': '👎',
  'heart': '❤️',
  'heart_eyes': '😍',
  'kissing_heart': '😘',
  'broken_heart': '💔',
  'smile': '😄',
  'smiley': '😃',
  'grinning': '😀',
  'grin': '😁',
  'joy': '😂',
  'rofl': '🤣',
  'sweat_smile': '😅',
  'laughing': '😆',
  'innocent': '😇',
  'blush': '😊',
  'wink': '😉',
  'relaxed': '☺️',
  'yum': '😋',
  'stuck_out_tongue': '😛',
  'stuck_out_tongue_closed_eyes': '😝',
  'stuck_out_tongue_winking_eye': '😜',
  'thinking_face': '🤔',
  'thinking': '🤔',
  'shrug': '🤷',
  'facepalm': '🤦',
  'saluting_face': '🫡',
  'raised_hands': '🙌',
  'clap': '👏',
  'pray': '🙏',
  'ok_hand': '👌',
  'pinching_hand': '🤏',
  'victory_hand': '✌️',
  'v': '✌️',
  'crossed_fingers': '🤞',
  'punch': '👊',
  'fist': '✊',
  'wave': '👋',
  'muscle': '💪',
  'eyes': '👀',
  'eye': '👁️',
  'point_up': '☝️',
  'point_down': '👇',
  'point_left': '👈',
  'point_right': '👉',
  'white_check_mark': '✅',
  'heavy_check_mark': '✔️',
  'check': '✅',
  'x': '❌',
  'negative_squared_cross_mark': '❎',
  'question': '❓',
  'grey_question': '❔',
  'exclamation': '❗',
  'grey_exclamation': '❕',
  'tada': '🎉',
  'sparkles': '✨',
  'fire': '🔥',
  'star': '⭐',
  'star2': '🌟',
  '100': '💯',
  'rocket': '🚀',
  'warning': '⚠️',
  'zap': '⚡',
  'boom': '💥',
  'collision': '💥',
  'bow': '🙇',
  'sweat': '😓',
  'cry': '😢',
  'sob': '😭',
  'disappointed': '😞',
  'pleading_face': '🥺',
  'screaming': '😱',
  'scream': '😱',
  'tired_face': '😫',
  'astonished': '😲',
  'coffee': '☕',
  'tea': '🍵',
  'beer': '🍺',
  'beers': '🍻',
  'cake': '🍰',
  'memo': '📝',
  'bulb': '💡',
  'eyes_rolling': '🙄',
  'rolling_eyes': '🙄',
};

/**
 * 投稿からリアクション配列を安全に抽出
 */
export const getPostReactions = (post: MattermostPost): MattermostReaction[] => {
  if (post.metadata?.reactions && Array.isArray(post.metadata.reactions)) {
    return post.metadata.reactions;
  }
  if (post.props?.reactions) {
    if (Array.isArray(post.props.reactions)) {
      return post.props.reactions;
    }
    if (typeof post.props.reactions === 'string') {
      try {
        const parsed = JSON.parse(post.props.reactions);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
  }
  return [];
};

/**
 * リアクションを絵文字名ごとにグルーピング・集計
 */
export const getGroupedReactions = (reactions?: MattermostReaction[]): GroupedReaction[] => {
  if (!reactions || reactions.length === 0) return [];
  const map = new Map<string, GroupedReaction>();
  for (const r of reactions) {
    const name = r.emoji_name;
    if (!name) continue;
    const existing = map.get(name);
    if (existing) {
      existing.count += 1;
      existing.users.push(r.user_id);
    } else {
      map.set(name, {
        name,
        count: 1,
        users: [r.user_id],
      });
    }
  }
  return Array.from(map.values());
};

/**
 * 絵文字名を表示用文字列に変換（標準絵文字ならUnicode、カスタム絵文字なら :name:）
 */
export const formatEmojiDisplay = (emojiName: string): { display: string; isUnicode: boolean } => {
  const cleanName = emojiName.replace(/^:+|:+$/g, '');
  const unicodeEmoji = COMMON_EMOJI_MAP[cleanName];
  if (unicodeEmoji) {
    return { display: unicodeEmoji, isUnicode: true };
  }
  return { display: `:${cleanName}:`, isUnicode: false };
};

/**
 * チャンネルにメッセージを新規投稿、またはスレッドに返信
 */
export const createPost = async (
  serverUrl: string,
  token: string,
  channelId: string,
  message: string,
  rootId?: string,
  corsProxy?: string
): Promise<MattermostPost> => {
  const payload: { channel_id: string; message: string; root_id?: string } = {
    channel_id: channelId,
    message: message.trim(),
  };

  if (rootId && rootId.trim() !== '') {
    payload.root_id = rootId.trim();
  }

  return request<MattermostPost>(
    serverUrl,
    token,
    '/api/v4/posts',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    corsProxy
  );
};

/**
 * チャンネルのMattermost公式WebアプリURLを生成する
 */
export const buildMattermostChannelUrl = (
  serverUrl?: string,
  channel?: MattermostChannel | null,
  teams?: MattermostTeam[],
  webUrl?: string
): string => {
  const targetBaseUrl = (webUrl && webUrl.trim() !== '') ? webUrl : serverUrl;
  if (!targetBaseUrl || !channel) return '';
  const base = targetBaseUrl.trim().replace(/\/+$/, '');

  // チーム名の特定
  let teamName = channel.team_name;
  if (!teamName && channel.team_id && teams && teams.length > 0) {
    const t = teams.find((item) => item.id === channel.team_id);
    if (t) teamName = t.name;
  }
  if (!teamName && teams && teams.length > 0) {
    teamName = teams[0].name;
  }

  const channelSlug = channel.name || channel.id;
  if (teamName) {
    return `${base}/${teamName}/channels/${channelSlug}`;
  }

  return `${base}/channels/${channelSlug}`;
};

/**
 * 投稿にリアクション（スタンプ）を追加する
 */
export const addReaction = async (
  serverUrl: string,
  token: string,
  userId: string,
  postId: string,
  emojiName: string,
  corsProxy?: string
): Promise<MattermostReaction> => {
  const cleanName = emojiName.trim().replace(/^:+|:+$/g, '');
  return request<MattermostReaction>(
    serverUrl,
    token,
    '/api/v4/reactions',
    {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        post_id: postId,
        emoji_name: cleanName,
      }),
    },
    corsProxy
  );
};

/**
 * 投稿からリアクション（スタンプ）を削除する
 */
export const removeReaction = async (
  serverUrl: string,
  token: string,
  userId: string,
  postId: string,
  emojiName: string,
  corsProxy?: string
): Promise<{ status: string }> => {
  const cleanName = emojiName.trim().replace(/^:+|:+$/g, '');
  return request<{ status: string }>(
    serverUrl,
    token,
    `/api/v4/users/${encodeURIComponent(userId)}/posts/${encodeURIComponent(postId)}/reactions/${encodeURIComponent(cleanName)}`,
    {
      method: 'DELETE',
    },
    corsProxy
  );
};

