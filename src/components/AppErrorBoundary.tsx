import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("hooked app crashed", error, info);
  }

  render() {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    const message = error.message || "Unexpected app error";
    const isConvexDeployError =
      message.includes("Could not find public function") ||
      message.includes("npx convex dev") ||
      message.includes("npx convex deploy");

    return (
      <main className="fatal-screen">
        <section className="fatal-card" aria-live="assertive">
          <p className="fatal-kicker">Hooked is not ready yet</p>
          <h1>{isConvexDeployError ? "Backend deploy required" : "Something broke"}</h1>
          <p className="fatal-copy">
            {isConvexDeployError
              ? "The app is live, but the Convex functions have not been deployed to this backend yet."
              : "The app hit an unexpected error while loading your session."}
          </p>
          <pre className="fatal-detail">{message}</pre>
          <button className="fatal-action" type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </section>
      </main>
    );
  }
}
