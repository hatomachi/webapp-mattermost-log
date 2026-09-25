import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Eye,
  Download,
  Loader2,
  Paperclip,
} from 'lucide-react';
import { MattermostPost, MattermostFileInfo } from '../types/mattermost';
import { formatFileSize, downloadFile, getFilesInfo } from '../services/mattermost';

interface AttachmentListProps {
  post: MattermostPost;
  serverUrl: string;
  token: string;
  corsProxy?: string;
  onPreviewImage: (files: MattermostFileInfo[], index: number) => void;
  className?: string;
}

export const AttachmentList: React.FC<AttachmentListProps> = ({
  post,
  serverUrl,
  token,
  corsProxy,
  onPreviewImage,
  className = '',
}) => {
  const initialFiles = post.metadata?.files || [];
  const [resolvedFiles, setResolvedFiles] = useState<MattermostFileInfo[]>(initialFiles);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  // metadata.files がなく file_ids のみ存在する場合、バックグラウンドで解決
  useEffect(() => {
    if (initialFiles.length > 0) {
      setResolvedFiles(initialFiles);
      return;
    }

    if (post.file_ids && post.file_ids.length > 0) {
      let isCancelled = false;
      getFilesInfo(serverUrl, token, post.file_ids, corsProxy).then((infos) => {
        if (!isCancelled && infos.length > 0) {
          setResolvedFiles(infos);
        }
      });
      return () => {
        isCancelled = true;
      };
    }
  }, [post.id, post.file_ids, initialFiles, serverUrl, token, corsProxy]);

  const files = resolvedFiles.length > 0 ? resolvedFiles : initialFiles;

  // 画像ファイルのみのリスト
  const imageFiles = useMemo(() => {
    return files.filter((f) => {
      return (
        f.mime_type?.startsWith('image/') ||
        ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(
          (f.extension || '').toLowerCase()
        )
      );
    });
  }, [files]);

  // ファイルが全くない場合は非表示
  if (files.length === 0 && (!post.file_ids || post.file_ids.length === 0)) {
    return null;
  }

  // 単一ファイルのダウンロード処理
  const handleDownload = async (file: MattermostFileInfo) => {
    if (downloadingIds.has(file.id)) return;
    setDownloadingIds((prev) => new Set(prev).add(file.id));
    try {
      await downloadFile(serverUrl, token, file.id, file.name, corsProxy);
    } catch (err) {
      console.error(`Failed to download file ${file.name}:`, err);
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
    }
  };

  // file_ids のみの未解決ファイルを直接ダウンロード
  const handleDownloadFileId = async (fileId: string) => {
    if (downloadingIds.has(fileId)) return;
    setDownloadingIds((prev) => new Set(prev).add(fileId));
    try {
      await downloadFile(serverUrl, token, fileId, `attachment_${fileId}`, corsProxy);
    } catch (err) {
      console.error(`Failed to download fileId ${fileId}:`, err);
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  };

  return (
    <div className={`flex flex-wrap gap-1.5 mt-1 select-none ${className}`}>
      {files.length > 0 ? (
        files.map((file) => {
          const isImg =
            file.mime_type?.startsWith('image/') ||
            ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(
              (file.extension || '').toLowerCase()
            );
          const isDownloading = downloadingIds.has(file.id);

          if (isImg) {
            const imageIndex = imageFiles.findIndex((img) => img.id === file.id);
            return (
              <div
                key={file.id}
                className="inline-flex items-center rounded bg-zinc-900 border border-zinc-700/80 hover:border-zinc-500 shadow-sm transition-colors"
              >
                {/* プレビューボタン */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreviewImage(imageFiles, Math.max(0, imageIndex));
                  }}
                  className="inline-flex items-center space-x-1 px-1.5 py-0.5 border-r border-zinc-800 bg-sky-950/20 hover:bg-sky-950/60 text-sky-400 hover:text-sky-300 rounded-l transition-colors"
                  title="画像をプレビュー表示"
                >
                  <Eye className="w-3 h-3 shrink-0" />
                  <span className="text-[10px] font-medium">プレビュー</span>
                </button>

                {/* ダウンロードボタン */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(file);
                  }}
                  disabled={isDownloading}
                  className="inline-flex items-center space-x-1 px-1.5 py-0.5 hover:bg-zinc-800/80 text-zinc-300 hover:text-white rounded-r transition-colors disabled:opacity-50"
                  title={`クリックして「${file.name}」をダウンロード`}
                >
                  {isDownloading ? (
                    <Loader2 className="w-3 h-3 text-sky-400 animate-spin shrink-0" />
                  ) : (
                    <ImageIcon className="w-3 h-3 text-sky-400 shrink-0" />
                  )}
                  <span className="truncate max-w-[130px] text-[10px] font-mono" title={file.name}>
                    {file.name}
                  </span>
                  {file.size > 0 && (
                    <span className="text-zinc-500 text-[9px] font-mono shrink-0">
                      ({formatFileSize(file.size)})
                    </span>
                  )}
                  <Download className="w-2.5 h-2.5 text-zinc-500 hover:text-zinc-300 shrink-0 ml-0.5" />
                </button>
              </div>
            );
          }

          // 通常ファイル（PDF、テキスト、ZIP等）
          return (
            <button
              key={file.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload(file);
              }}
              disabled={isDownloading}
              className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 hover:border-zinc-500 text-[10px] text-zinc-300 hover:text-white font-mono shadow-sm transition-colors disabled:opacity-50"
              title={`クリックして「${file.name}」をダウンロード`}
            >
              {isDownloading ? (
                <Loader2 className="w-3 h-3 text-sky-400 animate-spin shrink-0" />
              ) : (
                <FileText className="w-3 h-3 text-amber-400 shrink-0" />
              )}
              <span className="truncate max-w-[140px]" title={file.name}>
                {file.name}
              </span>
              {file.size > 0 && (
                <span className="text-zinc-500 text-[9px] shrink-0">
                  ({formatFileSize(file.size)})
                </span>
              )}
              <Download className="w-2.5 h-2.5 text-zinc-500 hover:text-zinc-300 shrink-0 ml-0.5" />
            </button>
          );
        })
      ) : (
        // metadata.files が取得できず file_ids のみの場合
        post.file_ids?.map((fileId, idx) => {
          const isDownloading = downloadingIds.has(fileId);
          return (
            <button
              key={fileId}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadFileId(fileId);
              }}
              disabled={isDownloading}
              className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 text-[10px] text-zinc-400 hover:text-zinc-200 shadow-sm transition-colors disabled:opacity-50"
              title="クリックして添付ファイルをダウンロード"
            >
              {isDownloading ? (
                <Loader2 className="w-2.5 h-2.5 text-sky-400 animate-spin shrink-0" />
              ) : (
                <Paperclip className="w-2.5 h-2.5 text-zinc-400 shrink-0" />
              )}
              <span>添付 {idx + 1}</span>
              <Download className="w-2.5 h-2.5 text-zinc-500 shrink-0 ml-0.5" />
            </button>
          );
        })
      )}
    </div>
  );
};
