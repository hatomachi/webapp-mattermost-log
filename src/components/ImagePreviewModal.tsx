import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  AlertCircle,
  FileImage,
} from 'lucide-react';
import { MattermostFileInfo } from '../types/mattermost';
import { fetchFileBlobUrl, formatFileSize, downloadFile } from '../services/mattermost';

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: MattermostFileInfo[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  serverUrl: string;
  token: string;
  corsProxy?: string;
  onDownload?: (file: MattermostFileInfo) => void;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  isOpen,
  onClose,
  files,
  currentIndex,
  onNavigate,
  serverUrl,
  token,
  corsProxy,
  onDownload,
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  const currentFile = files[currentIndex];
  const hasMultiple = files.length > 1;

  // 画像Blob URLの読み込み
  useEffect(() => {
    if (!isOpen || !currentFile) {
      setBlobUrl(null);
      return;
    }

    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    fetchFileBlobUrl(serverUrl, token, currentFile.id, false, corsProxy)
      .then((url) => {
        if (!isCancelled) {
          setBlobUrl(url);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error('Failed to load preview image:', err);
          setError('画像の読み込みに失敗しました');
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, currentFile, serverUrl, token, corsProxy]);

  // 前後のナビゲーションハンドラー
  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      onNavigate(currentIndex - 1);
    }
  }, [currentIndex, onNavigate]);

  const handleNext = useCallback(() => {
    if (currentIndex < files.length - 1) {
      onNavigate(currentIndex + 1);
    }
  }, [currentIndex, files.length, onNavigate]);

  // キーボードショートカット
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, handlePrev, handleNext]);

  // ダウンロード実行
  const handleDownload = async () => {
    if (!currentFile || isDownloading) return;
    setIsDownloading(true);
    try {
      if (onDownload) {
        onDownload(currentFile);
      } else {
        await downloadFile(serverUrl, token, currentFile.id, currentFile.name, corsProxy);
      }
    } catch (err) {
      console.error('Failed to download file:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  // 別タブで開く
  const handleOpenExternal = () => {
    if (!blobUrl) return;
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
  };

  if (!isOpen || !currentFile) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col select-none animate-fadeIn"
      onClick={onClose}
    >
      {/* 上部ヘッダーバー */}
      <div
        className="w-full flex items-center justify-between px-3 sm:px-6 py-2.5 bg-zinc-950/80 border-b border-zinc-800/80 text-zinc-200 z-10 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左: ファイル情報 */}
        <div className="flex items-center space-x-2 min-w-0 mr-2">
          <FileImage className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="text-xs sm:text-sm font-medium truncate max-w-[200px] sm:max-w-[400px]" title={currentFile.name}>
            {currentFile.name}
          </span>
          {currentFile.size > 0 && (
            <span className="text-[11px] text-zinc-500 font-mono shrink-0">
              ({formatFileSize(currentFile.size)})
            </span>
          )}
          {hasMultiple && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400 shrink-0">
              {currentIndex + 1} / {files.length}
            </span>
          )}
        </div>

        {/* 右: アクションボタン群 */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {blobUrl && (
            <button
              type="button"
              onClick={handleOpenExternal}
              className="p-1.5 sm:px-2.5 sm:py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs flex items-center space-x-1 transition-colors"
              title="新しいタブで原寸画像を開く"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">別タブ</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading}
            className="p-1.5 sm:px-2.5 sm:py-1 rounded bg-sky-600/80 hover:bg-sky-500 text-white text-xs flex items-center space-x-1 transition-colors disabled:opacity-50"
            title="ファイルをダウンロード"
          >
            {isDownloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">ダウンロード</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors ml-1"
            title="閉じる (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* メインプレビュー領域 */}
      <div className="flex-1 w-full relative flex items-center justify-center p-2 sm:p-6 overflow-hidden">
        {/* 前へボタン */}
        {hasMultiple && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            disabled={currentIndex === 0}
            className="absolute left-2 sm:left-4 z-20 p-2 sm:p-3 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-white disabled:opacity-20 disabled:hover:bg-zinc-900/80 transition-all border border-zinc-700/60 shadow-lg"
            title="前の画像 (←)"
          >
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        {/* 次へボタン */}
        {hasMultiple && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            disabled={currentIndex === files.length - 1}
            className="absolute right-2 sm:right-4 z-20 p-2 sm:p-3 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-white disabled:opacity-20 disabled:hover:bg-zinc-900/80 transition-all border border-zinc-700/60 shadow-lg"
            title="次の画像 (→)"
          >
            <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        {/* 画像・ローディング・エラー表示 */}
        <div
          className="relative max-w-full max-h-full flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {isLoading && (
            <div className="flex flex-col items-center space-y-2 text-zinc-400 py-12">
              <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
              <span className="text-xs">画像を読み込み中...</span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center space-y-2 text-red-400 py-12">
              <AlertCircle className="w-8 h-8" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {blobUrl && !isLoading && (
            <img
              src={blobUrl}
              alt={currentFile.name}
              className="max-w-[92vw] max-h-[82vh] object-contain rounded shadow-2xl transition-transform duration-150"
              style={{ userSelect: 'none' }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
