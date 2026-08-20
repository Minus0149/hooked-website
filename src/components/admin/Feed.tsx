/**
 * Swipes as they land.
 *
 * Split out of AdminDashboard.tsx, which had grown to 1290 lines holding
 * fourteen components — every change to one screen meant scrolling past six
 * others. The markup is deliberately unchanged: these screens need a signed-in
 * admin to look at, so restyling them blind would be guesswork. Each adopts the
 * shared primitives in ui/ as it is next worked on.
 */
import { useState } from "react";
import { art } from "../../lib/art";
import { ACTION_COLOR, timeAgo } from "./shared";

export function FeedPanel({
  recent,
}: {
  recent: {
    _id: string;
    title: string;
    artist: string;
    artwork: string;
    action: string;
    email: string;
    _creationTime: number;
  }[];
}) {
  const [filter, setFilter] = useState<"all" | "save" | "skip" | "more" | "never">("all");
  const rows = recent.filter((s) => filter === "all" || s.action === filter);
  return (
    <>
      <h2 className="admin-h2">Live feed</h2>
      <p className="admin-dim">
        The most recent swipes across all users — streams in real time.
      </p>
      <div className="admin-toolbar">
        {(["all", "save", "skip", "more", "never"] as const).map((f) => (
          <button
            key={f}
            className={`admin-perm ${filter === f ? "on" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <section className="admin-panel">
        {rows.length === 0 && <p className="admin-dim">Nothing yet.</p>}
        {rows.map((s) => (
          <div className="admin-row" key={s._id}>
            <img src={art(s.artwork, 100)} alt="" />
            <div className="admin-row-meta">
              <strong>{s.title}</strong>
              <span>{s.artist}</span>
            </div>
            <span className="admin-feed-user">{s.email}</span>
            <span className="admin-dim">{timeAgo(s._creationTime)}</span>
            <span className="admin-action" style={{ color: ACTION_COLOR[s.action] }}>
              {s.action}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}
