import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { pct } from "./shared";

/**
 * The crash inbox: everything listeners sent from the error screen, newest
 * first. Expand a row for the full stack and whatever they were doing when
 * it broke.
 */
type Row = {
  _id: string;
  message: string;
  stack?: string;
  componentStack?: string;
  description?: string;
  platform: string;
  appVersion?: string;
  url?: string;
  userEmail?: string;
  anonKey?: string;
  at: number;
};

export function ReportsPanel() {
  const reports = useQuery(api.errors.listForAdmin) as Row[] | null | undefined;
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="admin-v2">
      <header className="admin-head">
        <h2>Error reports</h2>
        <p>
          Sent by listeners from the crash screen — description, stack, and
          where it happened. Newest first, last 50.
        </p>
      </header>

      {reports === undefined && <p className="admin-empty">Loading…</p>}
      {reports !== undefined && reports !== null && reports.length === 0 && (
        <p className="admin-empty">No reports. Either the app is perfect or the silence is worrying.</p>
      )}

      <ul className="campaign-list">
        {(reports ?? []).map((r) => {
          const isOpen = open === r._id;
          return (
            <li key={r._id} className="campaign-row" style={{ alignItems: "flex-start" }}>
              <div className="campaign-meta" style={{ flex: 1 }}>
                <strong>{r.message}</strong>
                {r.description && <span>“{r.description}”</span>}
                <small>
                  {new Date(r.at).toLocaleString()} · {r.platform}
                  {r.appVersion ? ` v${r.appVersion}` : ""} ·{" "}
                  {r.userEmail ?? (r.anonKey ? `anon ${r.anonKey.slice(0, 12)}…` : "unknown")}
                  {r.url ? ` · ${r.url.slice(0, 60)}` : ""}
                </small>
              </div>
              <button className="aq-btn" onClick={() => setOpen(isOpen ? null : r._id)}>
                {isOpen ? "hide" : "details"}
              </button>
              {isOpen && (
                <div className="report-detail">
                  {r.stack && <pre>{r.stack}</pre>}
                  {r.componentStack && (
                    <>
                      <b>component stack</b>
                      <pre>{r.componentStack}</pre>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
