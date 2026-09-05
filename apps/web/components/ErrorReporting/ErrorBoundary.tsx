"use client";

import { Component, ReactNode } from "react";
import { reportUnhandledError } from "@/lib/errorReporting";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// React error boundaries must be class components — there is no hooks
// equivalent of getDerivedStateFromError/componentDidCatch.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportUnhandledError({
      errorMessage: error.message || "Unhandled render error",
      stackTrace: error.stack
        ? `${error.stack}\n\nComponent stack:${info.componentStack ?? ""}`
        : (info.componentStack ?? undefined),
    });
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-surface px-6">
        <div className="max-w-sm text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-50 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-dark">Something went wrong</h1>
          <p className="text-sm text-muted">
            We&apos;ve automatically reported this issue to our team. Try
            reloading the page.
          </p>
          <button
            onClick={this.reload}
            className="px-4 py-2 rounded-lg bg-green text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
