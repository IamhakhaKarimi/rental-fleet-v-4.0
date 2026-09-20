import { Component, type ReactNode } from "react";

/**
 * Replaces the App Router's `error.tsx` convention. Next generated the boundary
 * for us and handed the segment a `reset()`; React has no hook equivalent, so
 * this is the one class component in the codebase — `componentDidCatch` exists
 * nowhere else.
 *
 * Wrapped around each route element rather than the whole tree, matching what
 * `(app)/error.tsx` did: a crash in Finance leaves the sidebar, the bottom nav
 * and the session intact, so "Try again" is a real option instead of a reload.
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Surface the real cause for diagnosis, as the old boundary did.
    console.error(error);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid place-items-center py-16 px-6">
        <div className="card p-6 max-w-md text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-danger">
            <span className="msr text-[22px]">error</span>
            <h2 className="text-base font-semibold">Something went wrong</h2>
          </div>
          <p className="text-sm text-muted break-words">
            {error.message || "An unexpected error occurred while loading this page."}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button className="btn btn-primary" onClick={this.reset}>
              <span className="msr text-[18px]">refresh</span>
              Try again
            </button>
            <button className="btn" onClick={() => location.assign("/")}>
              <span className="msr text-[18px]">home</span>
              Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
