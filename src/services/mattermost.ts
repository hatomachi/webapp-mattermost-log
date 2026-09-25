import {
  MattermostChannel,
  MattermostChannelMember,
  MattermostFileInfo,
  MattermostPost,
  MattermostPostListResponse,
  MattermostReaction,
  MattermostTeam,
  MattermostUser,
  MattermostCustomEmoji,
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
    ...(options.headers as Record<string, string> || {}),
  };

  // FormData の場合はブラウザが境界文字列 (boundary) を自動付与するため Content-Type を手動設定しない
  if (!(options.body instanceof FormData)) {
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

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

// 添付ファイルのBlob URLメモリキャッシュ
const fileBlobUrlCache = new Map<string, string>();
const fileInfoCache = new Map<string, MattermostFileInfo>();

/**
 * 添付ファイルのBlobURLを取得（認証ヘッダー付きでフェッチ、メモリキャッシュ）
 */
export const fetchFileBlobUrl = async (
  serverUrl: string,
  token: string,
  fileId: string,
  thumbnail: boolean = false,
  corsProxy?: string
): Promise<string> => {
  const cacheKey = `${fileId}_${thumbnail ? 'thumb' : 'full'}`;
  if (fileBlobUrlCache.has(cacheKey)) {
    return fileBlobUrlCache.get(cacheKey)!;
  }

  const path = thumbnail ? `/api/v4/files/${fileId}/thumbnail` : `/api/v4/files/${fileId}`;
  const url = buildUrl(serverUrl, path, corsProxy);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.trim()}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to load file: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  fileBlobUrlCache.set(cacheKey, blobUrl);
  return blobUrl;
};

/**
 * 添付ファイルをダウンロード（ブラウザの自動ダウンロードを発火）
 */
export const downloadFile = async (
  serverUrl: string,
  token: string,
  fileId: string,
  filename: string,
  corsProxy?: string
): Promise<void> => {
  const blobUrl = await fetchFileBlobUrl(serverUrl, token, fileId, false, corsProxy);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename || `file_${fileId}`;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

/**
 * ファイルメタデータを取得 (GET /api/v4/files/{file_id}/info)
 */
export const getFileInfo = async (
  serverUrl: string,
  token: string,
  fileId: string,
  corsProxy?: string
): Promise<MattermostFileInfo> => {
  if (fileInfoCache.has(fileId)) {
    return fileInfoCache.get(fileId)!;
  }
  const info = await request<MattermostFileInfo>(
    serverUrl,
    token,
    `/api/v4/files/${fileId}/info`,
    {},
    corsProxy
  );
  fileInfoCache.set(fileId, info);
  return info;
};

/**
 * 複数のfileIdのメタデータを取得
 */
export const getFilesInfo = async (
  serverUrl: string,
  token: string,
  fileIds: string[],
  corsProxy?: string
): Promise<MattermostFileInfo[]> => {
  const results = await Promise.all(
    fileIds.map(async (id) => {
      try {
        return await getFileInfo(serverUrl, token, id, corsProxy);
      } catch (err) {
        console.warn(`Failed to fetch file info for ${id}:`, err);
        return null;
      }
    })
  );
  return results.filter((f): f is MattermostFileInfo => f !== null);
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

export interface MattermostFileUploadResponse {
  file_infos: MattermostFileInfo[];
  client_ids: string[];
}

/**
 * チャンネルにファイルをアップロード (POST /api/v4/files)
 */
export const uploadFiles = async (
  serverUrl: string,
  token: string,
  channelId: string,
  files: File[],
  corsProxy?: string
): Promise<MattermostFileInfo[]> => {
  if (!files || files.length === 0) return [];

  const formData = new FormData();
  formData.append('channel_id', channelId);
  for (const file of files) {
    formData.append('files', file, file.name);
  }

  const res = await request<MattermostFileUploadResponse>(
    serverUrl,
    token,
    '/api/v4/files',
    {
      method: 'POST',
      body: formData,
    },
    corsProxy
  );

  return res.file_infos || [];
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
  fileIds?: string[],
  corsProxy?: string
): Promise<MattermostPost> => {
  const payload: {
    channel_id: string;
    message: string;
    root_id?: string;
    file_ids?: string[];
  } = {
    channel_id: channelId,
    message: message.trim(),
  };

  if (rootId && rootId.trim() !== '') {
    payload.root_id = rootId.trim();
  }
  if (fileIds && fileIds.length > 0) {
    payload.file_ids = fileIds;
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

/**
 * カスタム絵文字をキーワード検索
 */
export const searchCustomEmojis = async (
  serverUrl: string,
  token: string,
  term: string,
  corsProxy?: string
): Promise<MattermostCustomEmoji[]> => {
  return request<MattermostCustomEmoji[]>(
    serverUrl,
    token,
    '/api/v4/emoji/search',
    {
      method: 'POST',
      body: JSON.stringify({ term: term.trim() }),
    },
    corsProxy
  );
};

/**
 * カスタム絵文字の一覧取得（ページネーション対応）
 */
export const getCustomEmojis = async (
  serverUrl: string,
  token: string,
  page = 0,
  perPage = 32,
  corsProxy?: string
): Promise<MattermostCustomEmoji[]> => {
  return request<MattermostCustomEmoji[]>(
    serverUrl,
    token,
    `/api/v4/emoji?page=${page}&per_page=${perPage}&sort=name`,
    {},
    corsProxy
  );
};

// カスタム絵文字画像のBlob URLメモリキャッシュ
const emojiBlobUrlCache = new Map<string, string>();

/**
 * カスタム絵文字の画像Blob URLを取得（認証ヘッダー付きで取得しメモリキャッシュ）
 */
export const getEmojiImageUrl = async (
  serverUrl: string,
  token: string,
  emojiId: string,
  corsProxy?: string
): Promise<string> => {
  if (emojiBlobUrlCache.has(emojiId)) {
    return emojiBlobUrlCache.get(emojiId)!;
  }

  const url = buildUrl(serverUrl, `/api/v4/emoji/${emojiId}/image`, corsProxy);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.trim()}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch emoji image: ${res.status}`);
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  emojiBlobUrlCache.set(emojiId, blobUrl);
  return blobUrl;
};

/**
 * チャンネル所属ユーザー一覧を取得
 * 1. /api/v4/users?in_channel={channelId} を試行
 * 2. 失敗時は /api/v4/channels/{channelId}/members から user_ids を取得して getUsersByIds で解決
 */
export const getChannelUsers = async (
  serverUrl: string,
  token: string,
  channelId: string,
  corsProxy?: string
): Promise<MattermostUser[]> => {
  if (!channelId) return [];

  // 1. users?in_channel
  try {
    const users = await request<MattermostUser[]>(
      serverUrl,
      token,
      `/api/v4/users?in_channel=${encodeURIComponent(channelId)}&per_page=200`,
      {},
      corsProxy
    );
    if (Array.isArray(users) && users.length > 0) {
      return users.sort((a, b) => {
        const nameA = formatUserDisplayName(a);
        const nameB = formatUserDisplayName(b);
        return nameA.localeCompare(nameB, 'ja');
      });
    }
  } catch (err) {
    console.warn('Failed to fetch users directly via /api/v4/users?in_channel, falling back to channel members:', err);
  }

  // 2. フォールバック
  try {
    const members = await request<MattermostChannelMember[]>(
      serverUrl,
      token,
      `/api/v4/channels/${encodeURIComponent(channelId)}/members?per_page=200`,
      {},
      corsProxy
    );
    if (Array.isArray(members) && members.length > 0) {
      const userIds = members.map((m) => m.user_id).filter(Boolean);
      const users = await getUsersByIds(serverUrl, token, userIds, corsProxy);
      return users.sort((a, b) => {
        const nameA = formatUserDisplayName(a);
        const nameB = formatUserDisplayName(b);
        return nameA.localeCompare(nameB, 'ja');
      });
    }
  } catch (err) {
    console.error('Failed to fetch channel members fallback:', err);
    throw err;
  }

  return [];
};

