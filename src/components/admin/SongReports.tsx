/**
 * Songs listeners reported from the app ("Report this song" — Google Play's
 * UGC policy). Distinct from the Reports tab, which holds crash reports.
 * One row per track, the most-reported first; hiding the track takes it out
 * of everyone's deck and closes its reports, dismissing just closes them.
 */
import type { ReportGroup } from "../../../convex/contentReports";
import { art } from "../../lib/art";
import { REPORT_REASONS } from "../../lib/contentReport";
import { timeAgo } from "./shared";

const LABEL = Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r.label])) as Record<string, string>;

export function SongReportsPanel({
  groups,
  onResolve,
}: {
  groups: ReportGroup[];
  onResolve: (trackId: string, action: "dismiss" | "hide", title: string) => void;
}) {
  return (
    <>
      <h2 className="admin-h2">Song reports</h2>
      <p className="admin-dim">
        Songs listeners reported from the app. Hiding a song takes it out of everyone's deck and
        closes its reports; dismissing just closes them. Copyright reports are also emailed to
        copyright@hookedcue.com.
      </p>
      <section className="admin-panel">
        {groups.length === 0 && <p className="admin-dim">No open reports.</p>}
        {groups.map((g) => (
          <div className="admin-row" key={g.trackId}>
            {g.artwork ? <img src={art(g.artwork, 100)} alt="" /> : <span className="admin-row-noart" />}
            <div className="admin-row-meta">
              <strong>
                {g.title} {g.hidden && <span className="aq-tag rejected">hidden</span>}
              </strong>
              <span>
                {g.artist} · {g.count} report{g.count === 1 ? "" : "s"} · {timeAgo(g.lastAt)}
              </span>
              <span className="song-report-reasons">
                {Object.entries(g.reasons).map(([id, n]) => (
                  <span key={id} className="aq-tag">
                    {LABEL[id] ?? id} ×{n}
                  </span>
                ))}
              </span>
              {g.notes.map((n, i) => (
                <span key={i} className="song-report-note">“{n}”</span>
              ))}
            </div>
            <div className="aq-actions">
              {!g.hidden && (
                <button className="aq-btn no" onClick={() => onResolve(g.trackId, "hide", g.title)}>
                  hide song
                </button>
              )}
              <button className="aq-btn" onClick={() => onResolve(g.trackId, "dismiss", g.title)}>
                dismiss
              </button>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
