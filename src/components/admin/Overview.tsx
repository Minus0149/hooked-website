/**
 * The live ticker: the last half hour and the last day.
 *
 * Split out of AdminDashboard.tsx, which had grown to 1290 lines holding
 * fourteen components — every change to one screen meant scrolling past six
 * others. The markup is deliberately unchanged: these screens need a signed-in
 * admin to look at, so restyling them blind would be guesswork. Each adopts the
 * shared primitives in ui/ as it is next worked on.
 */
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { StatCard } from "../ui";
import { art } from "../../lib/art";

export function Overview({ stats }: { stats: NonNullable<ReturnType<typeof useStatsType>> }) {
  const todayTotal =
    stats.todayByAction.skip +
    stats.todayByAction.save +
    stats.todayByAction.more +
    stats.todayByAction.never;
  return (
    <>
      <h2 className="admin-h2">Overview</h2>
      <section className="admin-stats">
        <StatCard label="users" value={String(stats.userCount)} />
        <StatCard
          label="total swipes"
          value={String(stats.swipeCount)}
          sub={`${todayTotal} in the last 24h`}
        />
        <StatCard
          label="save rate"
          value={`${Math.round(stats.saveRate * 100)}%`}
          sub="saves ÷ all swipes"
          color="var(--save)"
        />
        <StatCard
          label="saves today"
          value={String(stats.todayByAction.save)}
          color="var(--save)"
        />
        <StatCard
          label="nevers today"
          value={String(stats.todayByAction.never)}
          color="var(--never)"
        />
      </section>

      <div className="admin-cols">
        <section className="admin-panel">
          <h3>Last 30 minutes</h3>
          <p className="admin-dim">One bar per minute — updates as swipes land.</p>
          <BarChart data={stats.activity} />
        </section>
        <section className="admin-panel">
          <h3>Last 24 hours</h3>
          <p className="admin-dim">One bar per hour.</p>
          <BarChart data={stats.activityHours} />
        </section>
      </div>

      <section className="admin-panel">
        <h3>Genre appetite</h3>
        <p className="admin-dim">
          Which sounds get swiped on most, and how often they convert to a save.
        </p>
        {stats.genres.length === 0 && <p className="admin-dim">No swipes yet.</p>}
        {stats.genres.map((g) => {
          const max = stats.genres[0]?.total ?? 1;
          const rate = g.total > 0 ? Math.round((g.saves / g.total) * 100) : 0;
          return (
            <div className="admin-genre" key={g.genre}>
              <span className="admin-genre-name">{g.genre}</span>
              <div className="admin-genre-bar">
                <div style={{ width: `${(g.total / max) * 100}%` }} />
              </div>
              <span className="admin-genre-rate" style={{ color: rate >= 30 ? "var(--save)" : "var(--muted)" }}>
                {g.total} swipes · {rate}% saved
              </span>
            </div>
          );
        })}
      </section>

      <div className="admin-cols">
        <section className="admin-panel">
          <h3>Top saved tracks</h3>
          {stats.topSaved.length === 0 && <p className="admin-dim">No saves yet.</p>}
          {stats.topSaved.map((t) => (
            <div className="admin-row" key={t.trackId}>
              <img src={art(t.artwork, 100)} alt="" />
              <div className="admin-row-meta">
                <strong>{t.title}</strong>
                <span>{t.artist}</span>
              </div>
              <span className="admin-count">{t.count}×</span>
            </div>
          ))}
        </section>
        <section className="admin-panel">
          <h3>Most "never"d artists</h3>
          {stats.topNever.length === 0 && (
            <p className="admin-dim">Nobody hates anything yet.</p>
          )}
          {stats.topNever.map((a) => (
            <div className="admin-row" key={a.artist}>
              <div className="admin-row-meta">
                <strong>{a.artist}</strong>
              </div>
              <span className="admin-count" style={{ color: "var(--never)" }}>
                {a.count}×
              </span>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

// helper so Overview's prop type tracks the server shape without duplication
function useStatsType() {
  return useQuery(api.admin.stats);
}

function BarChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="admin-chart">
      {data.map((count, i) => (
        <div
          key={i}
          className="admin-bar"
          style={{ height: `${8 + (count / max) * 92}%` }}
          title={`${count} swipes`}
        >
          {count > 0 && <span>{count}</span>}
        </div>
      ))}
    </div>
  );
}
