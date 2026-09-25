/**
 * Mattermost AI Adapter
 * 
 * Formats Mattermost channels, posts, threads, and user metadata
 * into rich Markdown context suitable for LLM reasoning and code agents (Claude Code).
 */

import { MattermostPost, MattermostUser, MattermostChannel, MattermostTeam } from '../../types/mattermost';
import {
  formatUserDisplayName,
  formatFileSize,
  getPostReactions,
  getGroupedReactions,
  buildMattermostChannelUrl,
} from '../../services/mattermost';
import { ContextAttachment } from './aiRemoteTypes';

export interface ContextFile {
  name: string;
  content: string;
  sizeBytes: number;
  previewSnippet: string;
}

export interface QuickPrompt {
  id: string;
  label: string;
  icon: string;
  description: string;
  prompt: string;
}

/**
 * Pre-defined quick wall-bounce / inquiry prompts
 */
export const QUICK_PROMPTS: QuickPrompt[] = [
  {
    id: 'summarize',
    label: '3行要約',
    icon: '📝',
    description: '直近の会話の流れと要点をコンパクトに整理',
    prompt: '添付されたコンテキストの会話ログを読み込み、議論の要点を3〜5行で端的にまとめてください。\n主なトピック、決定事項、未解決の論点があれば箇条書きで分かりやすく整理してください。',
  },
  {
    id: 'extract-todos',
    label: 'TODO・課題抽出',
    icon: '❓',
    description: '未解決のタスクや確認待ちの宿題を洗い出し',
    prompt: '添付された会話ログから、まだ結論が出ていない論点、誰かが確認・対応すべきTODO・アクションアイテム、宿題事項を漏れなく抽出してリストアップしてください。担当者や期限が示唆されていればそれも付記してください。',
  },
  {
    id: 'draft-reply',
    label: '返信案ドラフト',
    icon: '💡',
    description: '文脈に合わせた返信の文面案を生成',
    prompt: 'この会話の文脈を踏まえ、次に送信する返信メッセージの案を提案してください。\n1. 【簡潔な了解・確認パターン】（短く自然な返事）\n2. 【丁寧・提案パターン】（次のステップや補足を含む返事）\nの2通りを作成してください。',
  },
  {
    id: 'tech-explanation',
    label: '論点・背景解説',
    icon: '🔍',
    description: '会話に出てくる技術用語や背景をわかりやすく整理',
    prompt: 'この会話で登場している専門用語、システム仕様、または議論の背景について、初心者や途中参加者にも分かるように前提から分かりやすく解説・整理してください。',
  },
];

/**
 * Format a timestamp into YYYY-MM-DD HH:mm:ss
 */
function formatFullTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format a single Mattermost post into a Markdown line/block.
 * Appends compact ID metadata and thread context so LLM / agent can trace via API without cluttering visual layout.
 */
function formatPostBlock(
  post: MattermostPost,
  userCache: Record<string, MattermostUser>,
  options?: {
    indent?: string;
    rootPost?: MattermostPost;
  }
): string {
  const user = userCache[post.user_id];
  const authorName = user ? formatUserDisplayName(user) : `@${post.props?.override_username || post.user_id || 'unknown'}`;
  const timeStr = formatFullTimestamp(post.create_at);
  const indent = options?.indent || '';

  // Thread context annotation
  let threadAnnotation = '';
  if (post.root_id) {
    if (options?.rootPost) {
      const rootUser = userCache[options.rootPost.user_id];
      const rootAuthor = rootUser ? formatUserDisplayName(rootUser) : `@${options.rootPost.props?.override_username || options.rootPost.user_id || 'unknown'}`;
      const rootSnippet = (options.rootPost.message || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      const ellipsis = (options.rootPost.message || '').length > 24 ? '...' : '';
      threadAnnotation = ` (↳ @${rootAuthor}「${rootSnippet}${ellipsis}」への返信 [root: ${post.root_id}])`;
    } else {
      threadAnnotation = ` (↳ スレッド返信 [root: ${post.root_id}])`;
    }
  } else if (post.reply_count && post.reply_count > 0) {
    threadAnnotation = ` (💬 返信${post.reply_count}件あり)`;
  }

  const idMeta = `[id: ${post.id}]`;
  let output = `${indent}[${timeStr}] **${authorName}** ${idMeta}${threadAnnotation}:\n`;

  // Indent message lines
  const messageLines = (post.message || '(空のメッセージ)').split('\n');
  for (const line of messageLines) {
    output += `${indent}> ${line}\n`;
  }

  // Files
  if (post.metadata?.files && post.metadata.files.length > 0) {
    const fileList = post.metadata.files
      .map((f) => `\`${f.name}\` (${formatFileSize(f.size)})`)
      .join(', ');
    output += `${indent}> 📎 [添付ファイル: ${fileList}]\n`;
  }

  // Reactions
  const reactions = getGroupedReactions(getPostReactions(post));
  if (reactions.length > 0) {
    const reactionList = reactions
      .map((r) => `:${r.name}:(${r.count})`)
      .join(' ');
    output += `${indent}> 🏷️ [リアクション: ${reactionList}]\n`;
  }

  return output;
}

/**
 * Format channel posts into clean Markdown.
 * Preserves the exact chronological flat order as seen by the user on screen,
 * while seamlessly embedding thread parent context for thread replies.
 */
export function formatChannelLogsToMarkdown(params: {
  channel?: MattermostChannel;
  posts: MattermostPost[];
  userCache: Record<string, MattermostUser>;
  threadPosts?: Record<string, MattermostPost[]>;
  maxPosts?: number;
  serverUrl?: string;
  webUrl?: string;
  teams?: MattermostTeam[];
}): ContextFile {
  const {
    channel,
    posts,
    userCache,
    threadPosts = {},
    maxPosts = 100,
    serverUrl,
    webUrl,
    teams,
  } = params;

  const channelDisplayName = channel?.display_name || channel?.name || 'unknown-channel';
  const teamName = channel?.team_display_name || channel?.team_name || (teams && teams[0]?.name) || 'default-team';
  const channelUrl = buildMattermostChannelUrl(serverUrl, channel, teams, webUrl);
  const baseUrl = (webUrl && webUrl.trim() !== '') ? webUrl.trim().replace(/\/+$/, '') : (serverUrl || '').trim().replace(/\/+$/, '');
  const permalinkFormat = baseUrl ? `${baseUrl}/${teamName}/pl/{post_id}` : '/pl/{post_id}';

  // Merge posts and threadPosts cache to avoid any missing replies, keyed by ID
  const allPostMap = new Map<string, MattermostPost>();
  for (const p of posts) {
    allPostMap.set(p.id, p);
  }
  for (const rootId in threadPosts) {
    const replies = threadPosts[rootId];
    if (Array.isArray(replies)) {
      for (const r of replies) {
        if (!allPostMap.has(r.id)) {
          allPostMap.set(r.id, r);
        }
      }
    }
  }

  // Sort completely chronological (oldest to newest) to match user's visual timeline
  const chronological = Array.from(allPostMap.values()).sort((a, b) => a.create_at - b.create_at);
  const sorted = chronological.slice(-maxPosts);

  const startDateStr = sorted.length > 0 ? formatFullTimestamp(sorted[0].create_at) : 'なし';
  const endDateStr = sorted.length > 0 ? formatFullTimestamp(sorted[sorted.length - 1].create_at) : 'なし';

  let md = `# Mattermost Channel Log: #${channelDisplayName} (${teamName})\n\n`;
  md += `- 取得日時: ${formatFullTimestamp(Date.now())}\n`;
  md += `- チャンネル名: #${channelDisplayName}\n`;
  md += `- チャンネルID: ${channel?.id || 'unknown'}\n`;
  if (channelUrl) md += `- チャンネルURL: ${channelUrl}\n`;
  if (channel?.id) md += `- APIエンドポイント: /api/v4/channels/${channel.id}/posts\n`;
  md += `- パーマリンク形式: ${permalinkFormat}\n`;
  md += `- ログ表示順: 画面と同じ時系列順（上から順）\n`;
  md += `- ログ表示範囲: ${startDateStr} 〜 ${endDateStr} (取得${sorted.length}件 / 全${chronological.length}件)\n`;
  if (channel?.header) md += `- ヘッダー: ${channel.header}\n`;
  if (channel?.purpose) md += `- 目的: ${channel.purpose}\n`;
  md += `\n---\n\n`;

  for (const post of sorted) {
    const rootPost = post.root_id ? allPostMap.get(post.root_id) : undefined;
    md += formatPostBlock(post, userCache, { rootPost });
    md += '\n';
  }

  const safeChannelName = (channel?.name || channelDisplayName).replace(/[^a-zA-Z0-9_\-]/g, '_');
  const filename = `channel_${safeChannelName}_recent.md`;

  return {
    name: filename,
    content: md,
    sizeBytes: new Blob([md]).size,
    previewSnippet: md.slice(0, 300) + (md.length > 300 ? '...' : ''),
  };
}

/**
 * Format a single thread into clean Markdown
 */
export function formatThreadLogsToMarkdown(params: {
  channel?: MattermostChannel;
  rootPost: MattermostPost;
  replies: MattermostPost[];
  userCache: Record<string, MattermostUser>;
  serverUrl?: string;
  webUrl?: string;
  teams?: MattermostTeam[];
}): ContextFile {
  const { channel, rootPost, replies, userCache, serverUrl, webUrl, teams } = params;
  const channelDisplayName = channel?.display_name || channel?.name || 'unknown-channel';
  const teamName = channel?.team_display_name || channel?.team_name || (teams && teams[0]?.name) || 'default-team';
  const baseUrl = (webUrl && webUrl.trim() !== '') ? webUrl.trim().replace(/\/+$/, '') : (serverUrl || '').trim().replace(/\/+$/, '');
  const permalinkUrl = baseUrl ? `${baseUrl}/${teamName}/pl/${rootPost.id}` : '';

  let md = `# Mattermost Thread: #${channelDisplayName} (${teamName})\n\n`;
  md += `- スレッド親投稿ID: ${rootPost.id}\n`;
  md += `- チャンネルID: ${channel?.id || rootPost.channel_id || 'unknown'}\n`;
  if (permalinkUrl) md += `- スレッドURL: ${permalinkUrl}\n`;
  md += `- APIエンドポイント: /api/v4/posts/${rootPost.id}/thread\n`;
  md += `- 取得日時: ${formatFullTimestamp(Date.now())}\n`;
  md += `- 返信件数: ${replies.length}件\n\n`;
  md += `---\n\n`;

  md += `### 親投稿\n\n`;
  md += formatPostBlock(rootPost, userCache);
  md += `\n### 返信一覧\n\n`;

  const sortedReplies = [...replies]
    .filter((r) => r.id !== rootPost.id)
    .sort((a, b) => a.create_at - b.create_at);

  if (sortedReplies.length === 0) {
    md += `*(まだ返信はありません)*\n`;
  } else {
    for (const reply of sortedReplies) {
      md += formatPostBlock(reply, userCache, { rootPost });
      md += '\n';
    }
  }

  const filename = `thread_${rootPost.id.slice(0, 12)}.md`;

  return {
    name: filename,
    content: md,
    sizeBytes: new Blob([md]).size,
    previewSnippet: md.slice(0, 300) + (md.length > 300 ? '...' : ''),
  };
}

/**
 * Format channel posts into a ContextAttachment object
 */
export function formatChannelLogsToAttachment(params: {
  channel?: MattermostChannel;
  posts: MattermostPost[];
  userCache: Record<string, MattermostUser>;
  threadPosts?: Record<string, MattermostPost[]>;
  maxPosts?: number;
  serverUrl?: string;
  webUrl?: string;
  teams?: MattermostTeam[];
}): ContextAttachment {
  const { channel, posts, userCache, threadPosts, maxPosts = 100, serverUrl, webUrl, teams } = params;
  const channelDisplayName = channel?.display_name || channel?.name || 'チャンネル';
  const file = formatChannelLogsToMarkdown({ channel, posts, userCache, threadPosts, maxPosts, serverUrl, webUrl, teams });
  const sorted = [...posts].slice(-maxPosts);

  return {
    id: `channel_${channel?.id || 'curr'}_${Date.now()}`,
    type: 'channel_log',
    title: `#${channelDisplayName} ログ`,
    badge: `${sorted.length}件`,
    subtitle: channel?.purpose || '直近のチャンネル会話',
    contentMarkdown: file.content,
  };
}

/**
 * Format a thread into a ContextAttachment object
 */
export function formatThreadLogsToAttachment(params: {
  channel?: MattermostChannel;
  rootPost: MattermostPost;
  replies: MattermostPost[];
  userCache: Record<string, MattermostUser>;
  serverUrl?: string;
  webUrl?: string;
  teams?: MattermostTeam[];
}): ContextAttachment {
  const { channel, rootPost, replies, userCache, serverUrl, webUrl, teams } = params;
  const channelDisplayName = channel?.display_name || channel?.name || 'チャンネル';
  const file = formatThreadLogsToMarkdown({ channel, rootPost, replies, userCache, serverUrl, webUrl, teams });
  const user = userCache[rootPost.user_id];
  const authorName = user ? formatUserDisplayName(user) : `@${rootPost.user_id || 'unknown'}`;
  const preview = (rootPost.message || '').replace(/\s+/g, ' ').slice(0, 20);

  return {
    id: `thread_${rootPost.id}`,
    type: 'thread_log',
    title: `スレッド: @${authorName}「${preview}...」`,
    badge: `返信${replies.length}件`,
    subtitle: `#${channelDisplayName} 内のスレッド`,
    contentMarkdown: file.content,
  };
}

/**
 * Format unread channels digest into a ContextAttachment object
 */
export function formatUnreadDigestToAttachment(params: {
  unreadItems: Array<{ channel: MattermostChannel; posts: MattermostPost[]; unreadCount: number }>;
  userCache: Record<string, MattermostUser>;
}): ContextAttachment {
  const { unreadItems, userCache } = params;
  let md = `# Mattermost 未読キャッチアップ ダイジェスト\n\n`;
  md += `- 取得日時: ${formatFullTimestamp(Date.now())}\n`;
  md += `- 未読チャンネル数: ${unreadItems.length}件\n\n`;
  md += `---\n\n`;

  let totalPosts = 0;
  for (const item of unreadItems) {
    const chName = item.channel.display_name || item.channel.name;
    const teamName = item.channel.team_display_name || item.channel.team_name || '';
    md += `## #${chName}${teamName ? ` (${teamName})` : ''} [未読: ${item.unreadCount}件]\n\n`;

    const recentPosts = [...item.posts].sort((a, b) => a.create_at - b.create_at).slice(-15);
    totalPosts += recentPosts.length;
    for (const post of recentPosts) {
      md += formatPostBlock(post, userCache);
      md += '\n';
    }
    md += '\n---\n\n';
  }

  return {
    id: `unread_digest_${Date.now()}`,
    type: 'unread_digest',
    title: `未読ダイジェスト`,
    badge: `${unreadItems.length}ch / ${totalPosts}件`,
    subtitle: `${unreadItems.length}チャンネルの最新ダイジェスト`,
    contentMarkdown: md,
  };
}

/**
 * Format a single post into a ContextAttachment object
 */
export function formatSinglePostToAttachment(params: {
  channel?: MattermostChannel;
  post: MattermostPost;
  userCache: Record<string, MattermostUser>;
  serverUrl?: string;
  webUrl?: string;
  teams?: MattermostTeam[];
}): ContextAttachment {
  const { channel, post, userCache, serverUrl, webUrl, teams } = params;
  const channelName = channel?.display_name || channel?.name || 'channel';
  const teamName = channel?.team_display_name || channel?.team_name || (teams && teams[0]?.name) || '';
  const user = userCache[post.user_id];
  const authorName = user ? formatUserDisplayName(user) : `@${post.user_id || 'unknown'}`;
  const timeStr = formatFullTimestamp(post.create_at);
  const baseUrl = (webUrl && webUrl.trim() !== '') ? webUrl.trim().replace(/\/+$/, '') : (serverUrl || '').trim().replace(/\/+$/, '');
  const permalinkUrl = baseUrl && teamName ? `${baseUrl}/${teamName}/pl/${post.id}` : '';

  let md = `# Mattermost 投稿抜粋: #${channelName}${teamName ? ` (${teamName})` : ''}\n\n`;
  md += `- 投稿ID: ${post.id}\n`;
  md += `- チャンネルID: ${channel?.id || post.channel_id || 'unknown'}\n`;
  if (post.root_id) md += `- スレッド親ID: ${post.root_id}\n`;
  if (permalinkUrl) md += `- 投稿URL: ${permalinkUrl}\n`;
  md += `- APIエンドポイント: /api/v4/posts/${post.id}\n`;
  md += `- 取得日時: ${formatFullTimestamp(Date.now())}\n\n`;
  md += `---\n\n`;
  md += formatPostBlock(post, userCache);

  const preview = (post.message || '').replace(/\s+/g, ' ').slice(0, 24);

  return {
    id: `post_${post.id}`,
    type: 'single_post',
    title: `@${authorName}:「${preview}...」`,
    badge: `#${channelName}`,
    subtitle: `${timeStr} の発言`,
    contentMarkdown: md,
  };
}

/**
 * Compose full prompt with attached context attachments injected at the top
 */
export function composeFullPrompt(userPrompt: string, attachments?: ContextAttachment[]): string {
  if (!attachments || attachments.length === 0) {
    return userPrompt;
  }

  let prompt = `以下の Mattermost 会話ログ（添付コンテキスト）を読み込んで、ユーザーの質問や指示に答えてください。\n\n`;

  for (const att of attachments) {
    prompt += `========================================================\n`;
    prompt += `📎 添付コンテキスト: ${att.title}${att.badge ? ` (${att.badge})` : ''}\n`;
    prompt += `========================================================\n`;
    prompt += att.contentMarkdown.trim() + '\n\n';
  }

  prompt += `========================================================\n`;
  prompt += `【ユーザーの指示・質問】\n`;
  prompt += `========================================================\n`;
  prompt += userPrompt;

  return prompt;
}

