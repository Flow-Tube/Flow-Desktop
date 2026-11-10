import { Component, type ErrorInfo, type ReactNode } from "react";
import { getString } from "../lib/i18n/index";
import { reportFatalError } from "../lib/diagnostics";
import { Button } from "./ui/Button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
}

/**
 * Top-level boundary so an uncaught render error shows a recoverable state
 * instead of a blank window, and always leaves a trace (backend log + the
 * diagnostics ring buffer) rather than vanishing into the WebView console.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportFatalError(error, info.componentStack ?? undefined);
    console.error("Uncaught render error:", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-chrome-neutral-800 bg-surface-container p-8 text-center">
          <h1 className="text-lg font-semibold text-chrome-neutral-100">
            {getString("error_boundary_title")}
          </h1>
          <p className="mt-2 text-sm text-chrome-neutral-400">
            {getString("error_boundary_subtitle")}
          </p>
          {this.state.message ? (
            <p className="mt-4 break-words rounded-lg border border-chrome-neutral-800 bg-surface-container-high px-3 py-2 text-start text-xs text-chrome-neutral-400">
              {this.state.message}
            </p>
          ) : null}
          <div className="mt-6 flex justify-center">
            <Button variant="primary" onClick={this.handleReload}>
              {getString("error_boundary_reload")}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
