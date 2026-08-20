/**
 * Artist applications waiting on a yes or a no.
 *
 * Split out of AdminDashboard.tsx, which had grown to 1290 lines holding
 * fourteen components — every change to one screen meant scrolling past six
 * others. The markup is deliberately unchanged: these screens need a signed-in
 * admin to look at, so restyling them blind would be guesswork. Each adopts the
 * shared primitives in ui/ as it is next worked on.
 */
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

type CreatorData = NonNullable<ReturnType<typeof useCreatorsType>>;
function useCreatorsType() {
  return useQuery(api.creators.listCreators);
}

export function CreatorsPanel({
  data,
  onDecide,
}: {
  data: CreatorData;
  onDecide: (id: string, status: "pending" | "approved" | "rejected") => void;
}) {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const rows = data.creators.filter((c) => filter === "all" || c.status === filter);

  return (
    <>
      <header className="admin-head">
        <h2>Creator applications</h2>
        <p>
          Approving an artist lets them add their own tracks, upload full audio
          and mark several hooks per song. Nothing they add reaches the deck
          until they publish it themselves.
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
            {f === "pending" && ` (${data.pending})`}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="aq-empty">
          Nothing {filter === "all" ? "here" : `marked ${filter}`} yet.
        </p>
      ) : (
        rows.map((c) => (
          <div className="aq-row" key={c._id}>
            <div className="aq-main">
              <div className="aq-email">{c.artistName}</div>
              <div className="aq-meta">
                <span className={`aq-tag ${c.status}`}>{c.status}</span>
                {c.email} · applied {new Date(c.appliedAt).toLocaleDateString()}
                {c.bio ? ` · “${c.bio}”` : ""}
                {c.decidedBy ? ` · decided by ${c.decidedBy}` : ""}
              </div>
              {c.links && c.links.length > 0 && (
                <div className="aq-meta">
                  {c.links.map((l) => (
                    <a key={l} href={l} target="_blank" rel="noreferrer noopener" className="aq-link">
                      {l.replace(/^https?:\/\//, "").slice(0, 48)}
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="aq-actions">
              {c.status !== "approved" && (
                <button className="aq-btn yes" onClick={() => onDecide(c._id, "approved")}>
                  approve
                </button>
              )}
              {c.status !== "rejected" && (
                <button className="aq-btn no" onClick={() => onDecide(c._id, "rejected")}>
                  reject
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </>
  );
}

/* ---------------- users ---------------- */
