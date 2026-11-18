import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  buildWebReport,
  copyReport,
  mailtoHref,
  type ErrorReport,
} from "../lib/error-report";
import { RECHECK_MS, backendDown, looksLikeServerError } from "../lib/backendHealth";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string;

type Props = {
  children: ReactNode;
  /** true when this boundary sits INSIDE the convex provider, so the
      fallback can offer "send report" through the backend itself */
  reportable?: boolean;
};

type State = {
  error: Error | null;
  info: ErrorInfo | null;
  /** for a "Server Error": is the whole backend down? null while we ask */
  down: boolean | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, down: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, down: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("hooked app crashed", error, info);
    this.setState({ info });
    // A backend that is switched off answers every call with "Server Error":
    // ask once whether it's the whole backend before showing a crash.
    if (looksLikeServerError(error.message || "")) {
      void backendDown(CONVEX_URL).then((down) => this.setState({ down }));
    }
  }

  render() {
    const { error, info } = this.state;

    if (!error) {
      return this.props.children;
    }

    const message = error.message || "Unexpected app error";
    if (looksLikeServerError(message)) {
      if (this.state.down === null) return <main className="fatal-screen" aria-busy="true" />;
      if (this.state.down) return <Maintenance />;
    }
    const isConvexDeployError =
      message.includes("Could not find public function") ||
      message.includes("npx convex dev") ||
      message.includes("npx convex deploy");

    return (
      <main className="fatal-screen">
        <section className="fatal-card" aria-live="assertive">
          <p className="fatal-kicker">HookedCue is not ready yet</p>
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
          {/* the report panel is the owner's eyes: every crash can be sent,
              with everything needed to reproduce it, in one tap */}
          {this.props.reportable && (
            <ReportPanel
              report={buildWebReport(error, info)}
              onDismiss={() => this.setState({ error: null, info: null })}
            />
          )}
        </section>
      </main>
    );
  }
}

/**
 * Shown instead of the crash screen while the backend itself is down. Checks
 * again every 30 s and opens the app by itself once it answers, so nobody has
 * to switch this off when the backend is back.
 */
export function Maintenance({ convexUrl = CONVEX_URL }: { convexUrl?: string }) {
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    const down = await backendDown(convexUrl);
    if (!down) window.location.reload();
    else setChecking(false);
  };

  useEffect(() => {
    const t = window.setInterval(() => void check(), RECHECK_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convexUrl]);

  return (
    <main className="fatal-screen">
      <section className="fatal-card" aria-live="polite">
        <p className="fatal-kicker">HookedCue</p>
        <h1>Back in a little while</h1>
        <p className="fatal-copy">
          HookedCue can't reach its server right now. Your saved songs are safe. This page opens the app by
          itself as soon as it's back.
        </p>
        <button className="fatal-action" type="button" disabled={checking} onClick={() => void check()}>
          {checking ? "Checking" : "Try now"}
        </button>
      </section>
    </main>
  );
}

/**
 * The reporting UI, as a function component so it can use the convex
 * mutation. Three ways out, best first: straight to the admin inbox, then
 * the clipboard, then email — the last two work even when the crash took
 * the backend down with it.
 */
function ReportPanel({
  report,
  onDismiss,
}: {
  report: ErrorReport;
  onDismiss: () => void;
}) {
  const send = useMutation(api.errors.report);
  const [description, setDescription] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const payload = { ...report, description: description.trim() || undefined };

  const sendReport = async () => {
    setState("sending");
    try {
      const anonKey = localStorage.getItem("hooked.anon") ?? undefined;
      await send({ ...payload, anonKey });
      setState("sent");
    } catch {
      setState("failed"); // backend's down — clipboard/mail still work below
    }
  };

  return (
    <div className="report-panel">
      {state === "sent" ? (
        <p className="report-done">Report sent — thank you. It's in the admin inbox with the full stack.</p>
      ) : (
        <>
          <textarea
            className="report-notes"
            rows={2}
            placeholder="what were you doing when it broke? (optional)"
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="report-actions">
            <button
              type="button"
              className="prefs-chip on"
              disabled={state === "sending"}
              onClick={() => void sendReport()}
            >
              {state === "sending" ? "sending…" : "send report"}
            </button>
            <button
              type="button"
              className="prefs-chip"
              onClick={() => void copyReport(payload).then((ok) => ok && setState("failed"))}
            >
              copy details
            </button>
            <a className="prefs-chip" href={mailtoHref(payload)}>
              email it
            </a>
          </div>
          {state === "failed" && (
            <p className="report-note">
              couldn't reach the backend (likely the same problem) — copied or
              emailed details work just as well
            </p>
          )}
        </>
      )}
      <button type="button" className="report-dismiss" onClick={onDismiss}>
        try to continue anyway
      </button>
    </div>
  );
}
