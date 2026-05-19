'use client';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  name: string;
  children: ReactNode;
  fallback?: (err: Error, name: string) => ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // v0.1: log to console; v0.2 wires Sentry or similar.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary:${this.props.name}]`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.props.name);
      return (
        <div className="p-4 text-sm text-[var(--text-dim)] bg-[var(--surface-2)] rounded-md border border-[var(--border)]">
          <strong className="text-[var(--text)]">{this.props.name} error</strong> — reload to continue.
          <div className="mt-1 font-mono text-xs opacity-70">{this.state.error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}
