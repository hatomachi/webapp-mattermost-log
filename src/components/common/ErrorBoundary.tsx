import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught component error:', error, errorInfo);
  }

  private handleReset = () => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    try {
      localStorage.removeItem('ai_remote_last_session_v1');
    } catch {}
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 bg-zinc-950 text-zinc-100 min-h-[200px] border border-rose-900/60 rounded-xl m-4 text-center font-sans space-y-3">
          <div className="w-10 h-10 rounded-full bg-rose-950/80 border border-rose-700/60 flex items-center justify-center text-rose-400">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-zinc-100 mb-1">
              {this.props.fallbackTitle || 'コンポーネントでエラーが発生しました'}
            </h3>
            <p className="text-xs text-zinc-400 max-w-sm mb-2 break-words">
              {this.state.error?.message || '予期せぬランタイムエラーが発生しました。'}
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white rounded-lg text-xs font-medium shadow-md transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>セッションキャッシュをリセットして再読込</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
