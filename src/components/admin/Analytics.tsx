/**
 * The slower report: growth, retention, the invite funnel, catalogue health.
 *
 * Split out of AdminDashboard.tsx, which had grown to 1290 lines holding
 * fourteen components — every change to one screen meant scrolling past six
 * others. The markup is deliberately unchanged: these screens need a signed-in
 * admin to look at, so restyling them blind would be guesswork. Each adopts the
 * shared primitives in ui/ as it is next worked on.
 */
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { StatCard } from "../ui";
import { art } from "../../lib/art";
import { pct } from "./shared";

/**
 * The snapshot is stored as JSON in appSettings (v.any), so the wire type is
 * loose — this is the contract the nightly computation actually produces.
 */
export interface AnalyticsSnapshot {
  computedAt?: string;
  span: number;
  series: {
    date: string;
    dau: number;
    swipes: number;
    saves: number;
    signups: number;
    requests: number;
  }[];
  live: {
    dau: number;
    wau: number;
    mau: number;
    stickiness: number;
    swipesPerActive: number;
  };
  retention: { d1: number; d1Eligible: number; d7: number; d7Eligible: number };
  sessions: {
    count: number;
    swipesPer: number;
    perUser: number;
    longest: number;
  };
  funnel: {
    requested: number;
    approved: number;
    signedUp: number;
    activated: number;
    saved: number;
    ungated: number;
    pending: number;
    rejected: number;
    bySource: { app: number; landing: number };
  };
  catalogue: {
    total: number;
    published: number;
    withHook: number;
    multiHook: number;
    noAudio: number;
    unplayed: number;
    dead: number;
    hooks: number;
    hooksPerTrack: number;
  };
  hookPositions: {
    order: number;
    hooks: number;
    plays: number;
    saves: number;
    rate: number;
  }[];
  bestHooks: HookRow[];
  worstHooks: HookRow[];
  creators: {
    total: number;
    pending: number;
    approved: number;
    top: { artistName: string; email: string; tracks: number }[];
  };
}

interface HookRow {
  hookId: Id<"hooks">;
  trackId: string;
  title: string;
  artist: string;
  artwork: string;
  label?: string;
  order: number;
  startMs: number;
  plays: number;
  saves: number;
  rate: number;
}

type Analytics = AnalyticsSnapshot;
function useAnalyticsType(): AnalyticsSnapshot | null | undefined {
  return useQuery(api.admin.analytics, {}) as AnalyticsSnapshot | null | undefined;
}

/** Bars for volume, a line for the people — one grid, two scales. */
function TrendChart({
  series,
}: {
  series: Analytics["series"];
}) {
  const W = 720;
  const H = 180;
  const maxSwipes = Math.max(...series.map((d) => d.swipes), 1);
  const maxDau = Math.max(...series.map((d) => d.dau), 1);
  const step = W / Math.max(series.length, 1);
  const barW = Math.max(2, step * 0.55);

  const line = series
    .map((d, i) => `${i * step + step / 2},${H - (d.dau / maxDau) * (H - 24)}`)
    .join(" ");

  return (
    <div className="admin-trend">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        {series.map((d, i) => (
          <rect
            key={d.date}
            x={i * step + (step - barW) / 2}
            y={H - (d.swipes / maxSwipes) * (H - 24)}
            width={barW}
            height={(d.swipes / maxSwipes) * (H - 24)}
            rx={2}
            fill="rgba(255,255,255,.14)"
          >
            <title>{`${d.date} — ${d.swipes} swipes, ${d.dau} active, ${d.saves} saves`}</title>
          </rect>
        ))}
        {series.length > 1 && (
          <polyline
            points={line}
            fill="none"
            stroke="var(--save)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="admin-trend-legend">
        <span><i style={{ background: "rgba(255,255,255,.3)" }} /> swipes/day (max {maxSwipes})</span>
        <span><i style={{ background: "var(--save)" }} /> active users/day (max {maxDau})</span>
        <span className="admin-dim">
          {series[0]?.date} → {series[series.length - 1]?.date}
        </span>
      </div>
    </div>
  );
}

function FunnelBar({
  label,
  value,
  of,
  note,
  color,
}: {
  label: string;
  value: number;
  of: number;
  note?: string;
  color?: string;
}) {
  const share = of > 0 ? value / of : 0;
  return (
    <div className="admin-funnel-step">
      <div className="admin-funnel-head">
        <span>{label}</span>
        <strong style={color ? { color } : undefined}>{value}</strong>
        <span className="admin-dim">{of > 0 ? pct(share) : "—"}</span>
      </div>
      <div className="admin-funnel-track">
        <div style={{ width: `${Math.max(share * 100, value > 0 ? 2 : 0)}%`, background: color }} />
      </div>
      {note && <span className="admin-funnel-note">{note}</span>}
    </div>
  );
}

export function AnalyticsPanel({ a }: { a: Analytics }) {
  const health: { label: string; value: string; bad?: boolean; note: string }[] = [
    { label: "tracks", value: String(a.catalogue.total), note: "everything in the table" },
    {
      label: "in the deck",
      value: String(a.catalogue.published),
      note: "not hidden — what users can actually get",
    },
    {
      label: "broken cards",
      value: String(a.catalogue.dead),
      bad: a.catalogue.dead > 0,
      note: "live but unplayable or with no hook marked",
    },
    {
      label: "multi-hook",
      value: String(a.catalogue.multiHook),
      note: "more than one shot at landing",
    },
    {
      label: "never played",
      value: String(a.catalogue.unplayed),
      bad: a.catalogue.unplayed > a.catalogue.total / 2,
      note: "no swipe has ever reached these",
    },
    {
      label: "hooks / track",
      value: a.catalogue.hooksPerTrack.toFixed(2),
      note: `${a.catalogue.hooks} hooks total`,
    },
  ];

  return (
    <>
      <h2 className="admin-h2">Analytics</h2>
      <p className="admin-dim">
        The last {a.span} days. Everything here is computed live from swipes,
        requests and hooks — no sampling, no delay.
      </p>

      <section className="admin-stats">
        <StatCard label="active today" value={String(a.live.dau)} sub="swiped in the last 24h" />
        <StatCard label="active this week" value={String(a.live.wau)} />
        <StatCard
          label="stickiness"
          value={pct(a.live.stickiness)}
          sub="DAU ÷ MAU — days used per month"
          color={a.live.stickiness >= 0.2 ? "var(--save)" : undefined}
        />
        <StatCard
          label="next-day return"
          value={a.retention.d1Eligible ? pct(a.retention.d1) : "—"}
          sub={`${a.retention.d1Eligible} users had the chance`}
          color={a.retention.d1 >= 0.3 ? "var(--save)" : "var(--more)"}
        />
        <StatCard
          label="week-one return"
          value={a.retention.d7Eligible ? pct(a.retention.d7) : "—"}
          sub={`${a.retention.d7Eligible} users had the chance`}
        />
        <StatCard
          label="swipes / session"
          value={a.sessions.swipesPer.toFixed(1)}
          sub={`${a.sessions.count} sessions · longest run ${a.sessions.longest}`}
        />
      </section>

      <section className="admin-panel">
        <h3>Daily volume and reach</h3>
        <p className="admin-dim">
          Bars are swipes, the line is how many distinct people made them. A rising
          bar with a flat line means the same few users are going harder.
        </p>
        <TrendChart series={a.series} />
      </section>

      <div className="admin-cols">
        <section className="admin-panel">
          <h3>Invite funnel</h3>
          <p className="admin-dim">
            Each step as a share of the one above it. The gaps are where the
            product leaks.
          </p>
          <FunnelBar
            label="asked for access"
            value={a.funnel.requested}
            of={a.funnel.requested}
            note={`${a.funnel.bySource.landing} from the site · ${a.funnel.bySource.app} from the app · ${a.funnel.pending} still waiting on you`}
          />
          <FunnelBar
            label="approved"
            value={a.funnel.approved}
            of={a.funnel.requested}
            note={a.funnel.rejected ? `${a.funnel.rejected} rejected` : undefined}
          />
          <FunnelBar
            label="actually signed in"
            value={a.funnel.signedUp}
            of={a.funnel.approved}
            note="approved and then created an account"
          />
          <FunnelBar
            label="swiped at least once"
            value={a.funnel.activated}
            of={a.funnel.signedUp}
            color="var(--more)"
          />
          <FunnelBar
            label="saved something"
            value={a.funnel.saved}
            of={a.funnel.signedUp}
            color="var(--save)"
            note="the only step that means the product worked"
          />
          {a.funnel.ungated > 0 && (
            <p className="admin-dim" style={{ marginTop: 10 }}>
              {a.funnel.ungated} account{a.funnel.ungated === 1 ? "" : "s"} exist
              outside the queue (admins and anyone who joined before the gate).
            </p>
          )}
        </section>

        <section className="admin-panel">
          <h3>Catalogue health</h3>
          <p className="admin-dim">
            A card with no hook or no audio is a dead card — it burns a swipe and
            teaches the user nothing.
          </p>
          <div className="admin-health">
            {health.map((h) => (
              <div className={`admin-health-cell ${h.bad ? "bad" : ""}`} key={h.label}>
                <strong>{h.value}</strong>
                <span>{h.label}</span>
                <em>{h.note}</em>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="admin-panel">
        <h3>Does the second hook ever win?</h3>
        <p className="admin-dim">
          Save rate by hook position across the whole catalogue. If position 2
          beats position 1, the openers are being cut in the wrong place.
        </p>
        {a.hookPositions.length === 0 ? (
          <p className="admin-dim">No hooks have been played yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>position</th>
                <th>hooks</th>
                <th>plays</th>
                <th>saves</th>
                <th>save rate</th>
              </tr>
            </thead>
            <tbody>
              {a.hookPositions.map((p) => (
                <tr key={p.order}>
                  <td>hook {p.order + 1}</td>
                  <td>{p.hooks}</td>
                  <td>{p.plays}</td>
                  <td>{p.saves}</td>
                  <td style={{ color: p.rate >= 0.3 ? "var(--save)" : undefined }}>
                    {p.plays > 0 ? pct(p.rate) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="admin-cols">
        <section className="admin-panel">
          <h3>Hooks that land</h3>
          <p className="admin-dim">10 plays minimum, best save rate first.</p>
          {a.bestHooks.length === 0 && <p className="admin-dim">Not enough plays yet.</p>}
          {a.bestHooks.map((h) => (
            <HookRow key={h.hookId} h={h} good />
          ))}
        </section>
        <section className="admin-panel">
          <h3>Hooks to re-cut</h3>
          <p className="admin-dim">Played enough to judge, and nobody is biting.</p>
          {a.worstHooks.length === 0 && <p className="admin-dim">Nothing in the tail yet.</p>}
          {a.worstHooks.map((h) => (
            <HookRow key={h.hookId} h={h} />
          ))}
        </section>
      </div>

      <section className="admin-panel">
        <h3>Creators</h3>
        <p className="admin-dim">
          {a.creators.approved} approved · {a.creators.pending} waiting ·{" "}
          {a.creators.total} applied in total.
        </p>
        {a.creators.top.length === 0 && <p className="admin-dim">No approved creators yet.</p>}
        {a.creators.top.map((c) => (
          <div className="admin-row" key={c.email}>
            <div className="admin-row-meta">
              <strong>{c.artistName}</strong>
              <span>{c.email}</span>
            </div>
            <span className="admin-count">{c.tracks} tracks</span>
          </div>
        ))}
      </section>
    </>
  );
}

function HookRow({
  h,
  good,
}: {
  h: Analytics["bestHooks"][number];
  good?: boolean;
}) {
  const at = `${Math.floor(h.startMs / 60000)}:${String(
    Math.floor((h.startMs % 60000) / 1000),
  ).padStart(2, "0")}`;
  return (
    <div className="admin-row">
      <img src={art(h.artwork, 100)} alt="" />
      <div className="admin-row-meta">
        <strong>{h.title}</strong>
        <span>
          {h.artist} · hook {h.order + 1} at {at}
          {h.label ? ` · ${h.label}` : ""}
        </span>
      </div>
      <div className="admin-track-stats">
        <span>{h.plays} plays</span>
        <span style={{ color: good ? "var(--save)" : "var(--never)" }}>{pct(h.rate)}</span>
      </div>
    </div>
  );
}

/* ---------------- creators ---------------- */
