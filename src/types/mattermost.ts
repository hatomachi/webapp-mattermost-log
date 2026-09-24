export interface MattermostUser {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  nickname: string;
}

export interface MattermostTeam {
  id: string;
  name: string;
  display_name: string;
  description: string;
}

export type ChannelType = 'O' | 'P' | 'D' | 'G';

export interface MattermostChannel {
  id: string;
  team_id: string;
  name: string;
  display_name: string;
  type: ChannelType;
  header: string;
  purpose: string;
  last_post_at: number;
  total_msg_count: number;
  team_display_name?: string;
  team_name?: string;
}

export interface MattermostFileInfo {
  id: string;
  user_id: string;
  post_id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  name: string;
  extension: string;
  size: number;
  mime_type: string;
  width?: number;
  height?: number;
  has_preview_image?: boolean;
}

export interface MattermostReaction {
  user_id: string;
  post_id: string;
  emoji_name: string;
  create_at: number;
}

export interface MattermostPost {
  id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  user_id: string;
  channel_id: string;
  root_id: string;
  message: string;
  type?: string;
  has_reactions?: boolean;
  props?: {
    from_webhook?: string;
    override_username?: string;
    reactions?: MattermostReaction[] | string;
    [key: string]: any;
  };
  reply_count?: number;
  file_ids?: string[];
  metadata?: {
    files?: MattermostFileInfo[];
    reactions?: MattermostReaction[];
    [key: string]: any;
  };
}

export interface MattermostPostListResponse {
  order: string[];
  posts: Record<string, MattermostPost>;
  next_post_id?: string;
  prev_post_id?: string;
}

export type ChannelSortOrder = 'recent' | 'name';

export interface MattermostChannelMember {
  channel_id: string;
  user_id: string;
  roles: string;
  last_viewed_at: number;
  msg_count: number;
  mention_count: number;
  notify_props?: Record<string, any>;
  last_update_at?: number;
}

export interface UnreadChannelData {
  channel: MattermostChannel;
  member?: MattermostChannelMember;
  unreadCount: number;
  mentionCount: number;
  posts: MattermostPost[];
  isLoading: boolean;
  isRead: boolean;
  error?: string;
}

export type AppViewMode = 'log' | 'catchup';

export interface AppSettings {
  serverUrl: string;
  token: string;
  selectedTeamIds: string[];
  corsProxy?: string;
  showSeconds: boolean;
  showTeamBadge: boolean;
  showReactions: boolean;
  autoRefreshInterval: number; // 0, 15, 30, 60
  fontSize: 'xs' | 'sm' | 'base';
  channelSortOrder: ChannelSortOrder;
  collapseNewlines: boolean;
}

export interface ReplyTarget {
  rootId: string;
  postId: string;
  authorName: string;
  messagePreview: string;
  createAt: number;
}
