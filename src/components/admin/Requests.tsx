/**
 * The access queue. Approving an email is what lets that account exist.
 *
 * Split out of AdminDashboard.tsx, which had grown to 1290 lines holding
 * fourteen components — every change to one screen meant scrolling past six
 * others. The markup is deliberately unchanged: these screens need a signed-in
 * admin to look at, so restyling them blind would be guesswork. Each adopts the
 * shared primitives in ui/ as it is next worked on.
 */
import { useState } from "react";

type RequestStatus = "pending" | "approved" | "rejected";
type AccessRow = {
  _id: string;
  email: string;
  name: string;
  source: "app" | "landing";
  status: RequestStatus;
  device?: string;
  genres?: string[];
  notes?: string;
  submittedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  invited?: boolean;
};

/** The approval queue. Approving an email is what lets that account be created. */
export function RequestsPanel({
  data,
  onDecide,
  onInvited,
  onRemove,
}: {
  data: {
    total: number; pending: number; approved: number; rejected: number;
    fromApp: number; fromLanding: number; requests: AccessRow[];
  };
  onDecide: (id: string, status: RequestStatus) => void;
  onInvited: (id: string, invited: boolean) => void;
  onRemove: (id: string, email: string) => void;
}) {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const rows = data.requests.filter((r) => filter === "all" || r.status === filter);

  return (
    <>
      <header className="admin-head">
        <h2>Access requests</h2>
        <p>
          {data.pending} waiting · {data.approved} approved · {data.rejected} rejected ·{" "}
          {data.fromApp} from the app, {data.fromLanding} from the site
        </p>
      </header>

      <div className="aq-filters">
        {(["pending", "approved", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            className={`aq-filter ${filter === f ? "on" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
            {f !== "all" && ` (${f === "pending" ? data.pending : f === "approved" ? data.approved : data.rejected})`}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="aq-empty">Nothing {filter === "all" ? "here" : `marked ${filter}`} yet.</p>
      ) : (
        rows.map((r) => (
          <div className="aq-row" key={r._id}>
            <div className="aq-main">
              <div className="aq-email">{r.email}</div>
              <div className="aq-meta">
                <span className={`aq-tag ${r.status}`}>{r.status}</span>
                <span className="aq-tag">{r.source}</span>
                {r.invited && <span className="aq-tag approved">invited</span>}
                {r.name} · {new Date(r.submittedAt).toLocaleDateString()}
                {r.device ? ` · ${r.device}` : ""}
                {r.genres?.length ? ` · ${r.genres.join(", ")}` : ""}
                {r.notes ? ` · “${r.notes}”` : ""}
                {r.decidedBy ? ` · decided by ${r.decidedBy}` : ""}
              </div>
            </div>
            <div className="aq-actions">
              {r.status !== "approved" && (
                <button className="aq-btn yes" onClick={() => onDecide(r._id, "approved")}>
                  approve
                </button>
              )}
              {r.status !== "rejected" && (
                <button className="aq-btn no" onClick={() => onDecide(r._id, "rejected")}>
                  reject
                </button>
              )}
              {r.status === "approved" && (
                <button className="aq-btn" onClick={() => onInvited(r._id, !r.invited)}>
                  {r.invited ? "un-invite" : "mark invited"}
                </button>
              )}
              <button
                className="aq-btn no"
                title="Delete the row — for spam and test submissions"
                onClick={() => onRemove(r._id, r.email)}
              >
                remove
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
