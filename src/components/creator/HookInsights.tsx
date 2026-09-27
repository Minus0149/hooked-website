import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { moodById, type MoodId } from "../../data/mood";

/**
 * Free insights for one of the artist's own songs (convex/insights.ts): how
 * many people heard it, how many kept it, and where in the hook they leave.
 * Counts only — nothing shows until enough people have heard the song, and
 * small groups are folded into "other", so no listener can be picked out.
 *
 * The "promote this song" link hands off to the Promote panel above (web only).
 */

export const PROMOTE_EVENT = "hookedcue:promote";

export function HookInsights({ trackId }: { trackId: string }) {
  const [open, setOpen] = useState(false);
  const data = useQuery(api.insights.forTrack, open ? { trackId } : "skip");

  const promote = () => {
    window.dispatchEvent(new CustomEvent(PROMOTE_EVENT, { detail: trackId }));
  };

  return (
    <div className="insights">
      <div className="insights-bar">
        <button type="button" className="aq-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "hide insights" : "hook insights"}
        </button>
        <button type="button" className="aq-btn insights-promote" onClick={promote}>
          promote this song
        </button>
      </div>
      {open && data === undefined && <p className="insights-note">Loading…</p>}
      {open && data === null && <p className="insights-note">Insights are for your own uploads.</p>}
      {open && data && !data.enough && (
        <p className="insights-note">
          Not enough listeners yet — insights appear once {data.floor} people have heard it, so no one can be
          picked out.
        </p>
      )}
      {open && data && data.enough && (
        <div className="insights-body">
          <dl className="insights-stats">
            <div>
              <dt>listeners</dt>
              <dd>{data.listeners.toLocaleString("en-IN")}</dd>
            </div>
            <div>
              <dt>plays</dt>
              <dd>{data.plays.toLocaleString("en-IN")}</dd>
            </div>
            <div>
              <dt>kept</dt>
              <dd>{data.saveRate}%</dd>
            </div>
            <div>
              <dt>skips</dt>
              <dd>{data.skips.toLocaleString("en-IN")}</dd>
            </div>
          </dl>
          <div className="insights-curve" aria-label="share of listeners still listening, second by second">
            <span className="insights-label">still listening, second by second into the hook</span>
            <div className="insights-bars">
              {data.stillListening.map((pct, i) => (
                <i
                  key={i}
                  title={`${i}s: ${pct}%`}
                  className={i === data.steepestDrop ? "drop" : undefined}
                  style={{ height: `${Math.max(2, pct)}%` }}
                />
              ))}
            </div>
            {data.steepestDrop !== null && (
              <span className="insights-label">most people leave around {data.steepestDrop}s in</span>
            )}
          </div>
          {data.moods.length > 0 && (
            <p className="insights-row">
              <span className="insights-label">moods they were in</span>
              {data.moods
                .map((m) => `${m.name === "other" ? "other" : moodById(m.name as MoodId)?.label ?? m.name} ${m.share}%`)
                .join(" · ")}
            </p>
          )}
          {data.genres.length > 0 && (
            <p className="insights-row">
              <span className="insights-label">what its listeners like</span>
              {data.genres.map((g) => `${g.name} ${g.share}%`).join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
