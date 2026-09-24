/**
 * Mattermost AI Adapter
 * 
 * Formats Mattermost channels, posts, threads, and user metadata
 * into rich Markdown context suitable for LLM reasoning and code agents (Claude Code).
 */

import { MattermostPost, MattermostUser, MattermostChannel } from '../../types/mattermost';
import { formatUserDisplayName, formatFileSize, getPostReactions, getGroupedReactions } from '../../services/mattermost';

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
 * Format a single Mattermost post into a Markdown line/block
 */
function formatPostBlock(
  post: MattermostPost,
  userCache: Record<string, MattermostUser>,
  indent = ''
): string {
  const user = userCache[post.user_id];
  const authorName = user ? formatUserDisplayName(user) : `@${post.props?.override_username || post.user_id || 'unknown'}`;
  const timeStr = formatFullTimestamp(post.create_at);

  let output = `${indent}[${timeStr}] **${authorName}**:\n`;

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

  // Reply count hint if not expanded
  if (post.reply_count && post.reply_count > 0 && !indent) {
    output += `${indent}> 💬 (${post.reply_count}件のスレッド返信あり)\n`;
  }

  return output;
}

/**
 * Format channel posts into clean Markdown
 */
export function formatChannelLogsToMarkdown(params: {
  channel?: MattermostChannel;
  posts: MattermostPost[];
  userCache: Record<string, MattermostUser>;
  threadPosts?: Record<string, MattermostPost[]>;
  maxPosts?: number;
}): ContextFile {
  const { channel, posts, userCache, threadPosts = {}, maxPosts = 60 } = params;
  const channelDisplayName = channel?.display_name || channel?.name || 'unknown-channel';
  const teamName = channel?.team_display_name || channel?.team_name || 'default-team';

  // Sort chronological (oldest to newest)
  const sorted = [...posts].sort((a, b) => a.create_at - b.create_at).slice(-maxPosts);

  let md = `# Mattermost Channel Log: #${channelDisplayName} (${teamName})\n\n`;
  md += `- 取得日時: ${formatFullTimestamp(Date.now())}\n`;
  md += `- チャンネル名: #${channelDisplayName} (ID: ${channel?.id || 'unknown'})\n`;
  if (channel?.header) md += `- ヘッダー: ${channel.header}\n`;
  if (channel?.purpose) md += `- 目的: ${channel.purpose}\n`;
  md += `- 投稿件数: ${sorted.length}件\n\n`;
  md += `---\n\n`;

  for (const post of sorted) {
    // If it's a reply in a thread and root post is in list, we will show it under root
    if (post.root_id && sorted.some((p) => p.id === post.root_id)) {
      continue;
    }

    md += formatPostBlock(post, userCache);

    // If there are thread replies in cache, append them
    const replies = threadPosts[post.id] || [];
    if (replies.length > 0) {
      const sortedReplies = [...replies]
        .filter((r) => r.id !== post.id)
        .sort((a, b) => a.create_at - b.create_at);

      if (sortedReplies.length > 0) {
        md += `  > 💬 **--- スレッド返信 (${sortedReplies.length}件) ---**\n`;
        for (const reply of sortedReplies) {
          md += formatPostBlock(reply, userCache, '  ');
        }
        md += `  > 💬 **--- スレッド終了 ---**\n`;
      }
    }

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
}): ContextFile {
  const { channel, rootPost, replies, userCache } = params;
  const channelDisplayName = channel?.display_name || channel?.name || 'unknown-channel';

  let md = `# Mattermost Thread: #${channelDisplayName}\n\n`;
  md += `- スレッド親投稿ID: ${rootPost.id}\n`;
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
      md += formatPostBlock(reply, userCache);
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
