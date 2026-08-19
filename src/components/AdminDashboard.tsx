import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import { art } from "../lib/art";

const ACTION_COLOR: Record<string, string> = {
  skip: "#8E8C99",
  save: "var(--save)",
  more: "var(--more)",
  never: "var(--never)",
};

const PERM_LABEL: Record<string, string> = {
  "stats.view": "stats",
  "users.view": "see users",
  "users.manage": "manage users",
  "catalog.curate": "curate catalog",
};

type Tab =
  | "overview"
  | "analytics"
  | "requests"
  | "creators"
  | "users"
  | "catalog"
  | "feed";

const pct = (n: number) => `${Math.round(n * 100)}%`;

function timeAgo(ts: number | null): string {
  if (!ts) return "—";
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function AdminDashboard() {
  const session = authClient.useSession();
  const access = useQuery(api.admin.myAccess);
  const stats = useQuery(api.admin.stats);
  const userData = useQuery(api.admin.users);
  const catalog = useQuery(api.admin.catalog);
  const requests = useQuery(api.access.list);
  const analytics = useQuery(api.admin.analytics, {});
  const creatorData = useQuery(api.creators.listCreators);
  const decideCreator = useMutation(api.creators.decideCreator);
  const decide = useMutation(api.access.decide);
  const markInvited = useMutation(api.access.markInvited);
  const removeRequest = useMutation(api.access.remove);
  const setHidden = useMutation(api.tracks.setHidden);
  const backfillHooks = useMutation(api.hooks.backfill);
  const setPermission = useMutation(api.admin.setPermission);
  const setAdmin = useMutation(api.admin.setAdmin);

  const tabs = useMemo(() => {
    const t: { id: Tab; label: string; icon: string }[] = [];
    if (stats !== null) t.push({ id: "overview", label: "Overview", icon: "◈" });
    if (analytics !== null) t.push({ id: "analytics", label: "Analytics", icon: "▤" });
    if (requests !== null) {
      const pending = requests?.pending ?? 0;
      t.push({ id: "requests", label: pending ? `Requests (${pending})` : "Requests", icon: "✦" });
    }
    if (creatorData !== null) {
      const pending = creatorData?.pending ?? 0;
      t.push({ id: "creators", label: pending ? `Creators (${pending})` : "Creators", icon: "✸" });
    }
    if (userData !== null) t.push({ id: "users", label: "Users", icon: "◉" });
    if (catalog !== null) t.push({ id: "catalog", label: "Catalog", icon: "♪" });
    if (stats !== null) t.push({ id: "feed", label: "Live feed", icon: "≋" });
    return t;
  }, [stats, userData, catalog, requests, analytics, creatorData]);

  const [tab, setTab] = useState<Tab>("overview");
  const activeTab = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? "overview");

  const loading = access === undefined;
  const noAccess = access === null || access?.any === false;

  // hard gate: non-staff get bounced back into the app
  useEffect(() => {
    if (!loading && noAccess) {
      const t = window.setTimeout(() => {
        window.location.hash = "#/";
      }, 2500);
      return () => window.clearTimeout(t);
    }
  }, [loading, noAccess]);

  if (loading) {
    return <div className="admin admin-v2"><p className="admin-empty">Loading…</p></div>;
  }
  if (noAccess) {
    return (
      <div className="admin admin-v2">
        <div className="admin-empty">
          <h2>Staff only</h2>
          <p>This area requires dashboard permissions. Taking you back to the app…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin admin-v2">
      <aside className="admin-side">
        <div className="admin-side-brand">
          <span className="wordmark" style={{ fontSize: 18 }}>
            hooked<span className="dot">.</span>
          </span>
          <span className="admin-chip">{access?.isAdmin ? "admin" : "staff"}</span>
        </div>
        <span className="admin-live">
          <span className="admin-live-dot" /> live data
        </span>
        <nav className="admin-side-nav">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`admin-side-item ${activeTab === t.id ? "on" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <span className="admin-side-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="admin-side-foot">
          {session.data && <span className="admin-user">{session.data.user.email}</span>}
          <a className="admin-back" href="#/">← back to the app</a>
        </div>
      </aside>

      <motion.main
        key={activeTab}
        className="admin-content"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {activeTab === "overview" && stats && <Overview stats={stats} />}
        {activeTab === "analytics" && analytics && <AnalyticsPanel a={analytics} />}
        {activeTab === "creators" && creatorData && (
          <CreatorsPanel
            data={creatorData}
            onDecide={(id, status) =>
              void decideCreator({ id: id as never, status }).catch((e: Error) =>
                window.alert(e.message),
              )
            }
          />
        )}
        {activeTab === "requests" && requests && (
          <RequestsPanel
            data={requests}
            onDecide={(id, status) =>
              void decide({ id: id as never, status }).catch((e: Error) => window.alert(e.message))
            }
            onInvited={(id, invited) =>
              void markInvited({ id: id as never, invited }).catch((e: Error) => window.alert(e.message))
            }
            onRemove={(id, email) => {
              if (!window.confirm(`Remove the request from ${email}? This deletes the row.`)) return;
              void removeRequest({ id: id as never }).catch((e: Error) => window.alert(e.message));
            }}
          />
        )}
        {activeTab === "users" && userData && (
          <UsersPanel
            data={userData}
            isAdmin={access?.isAdmin ?? false}
            onSetAdmin={(profileId, isAdmin) =>
              void setAdmin({ profileId: profileId as never, isAdmin }).catch(
                (e: Error) => window.alert(e.message),
              )
            }
            onSetPermission={(profileId, permission, granted) =>
              void setPermission({
                profileId: profileId as never,
                permission,
                granted,
              }).catch(() => undefined)
            }
          />
        )}
        {activeTab === "catalog" && catalog && (
          <CatalogPanel
            catalog={catalog}
            onToggle={(trackId, hidden) => void setHidden({ trackId, hidden })}
            onBackfill={() =>
              backfillHooks({})
                .then((r) =>
                  window.alert(
                    r.tracksFilled === 0
                      ? "Every track already has a hook."
                      : `Gave ${r.tracksFilled} track${r.tracksFilled === 1 ? "" : "s"} ${r.hooksCreated} hooks between them.`,
                  ),
                )
                .catch((e: Error) => window.alert(e.message))
            }
          />
        )}
        {activeTab === "feed" && stats && <FeedPanel recent={stats.recent} />}
      </motion.main>
    </div>
  );
}

/* ---------------- overview ---------------- */

function Overview({ stats }: { stats: NonNullable<ReturnType<typeof useStatsType>> }) {
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

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="admin-stat">
      <span className="admin-stat-value" style={color ? { color } : undefined}>
        {value}
      </span>
      <span className="admin-stat-label">{label}</span>
      {sub && <span className="admin-stat-sub">{sub}</span>}
    </div>
  );
}

/* ---------------- analytics ---------------- */

type Analytics = NonNullable<ReturnType<typeof useAnalyticsType>>;
function useAnalyticsType() {
  return useQuery(api.admin.analytics, {});
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

function AnalyticsPanel({ a }: { a: Analytics }) {
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

type CreatorData = NonNullable<ReturnType<typeof useCreatorsType>>;
function useCreatorsType() {
  return useQuery(api.creators.listCreators);
}

function CreatorsPanel({
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

type UsersData = NonNullable<ReturnType<typeof useUsersType>>;
function useUsersType() {
  return useQuery(api.admin.users);
}

function UsersPanel({
  data,
  isAdmin,
  onSetAdmin,
  onSetPermission,
}: {
  data: UsersData;
  isAdmin: boolean;
  onSetAdmin: (profileId: string, isAdmin: boolean) => void;
  onSetPermission: (profileId: string, permission: string, granted: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"swipes" | "saved" | "active" | "joined">("active");
  const [selected, setSelected] = useState<string | null>(null);

  const users = useMemo(() => {
    const filtered = data.users.filter((u) =>
      u.email.toLowerCase().includes(search.toLowerCase()),
    );
    const key = {
      swipes: (u: UsersData["users"][number]) => u.swipeCount,
      saved: (u: UsersData["users"][number]) => u.savedCount,
      active: (u: UsersData["users"][number]) => u.lastActive ?? 0,
      joined: (u: UsersData["users"][number]) => u.joined,
    }[sort];
    return [...filtered].sort((a, b) => key(b) - key(a));
  }, [data.users, search, sort]);

  return (
    <>
      <h2 className="admin-h2">Users</h2>
      <p className="admin-dim">
        {isAdmin
          ? "Click a role to promote/demote admins; toggle dashboard permissions per user. Changes apply instantly."
          : "Read-only — ask an admin for the users.manage permission."}
      </p>
      <div className="admin-toolbar">
        <input
          className="admin-search"
          placeholder="search by email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="admin-sortrow">
          {(["active", "swipes", "saved", "joined"] as const).map((s) => (
            <button
              key={s}
              className={`admin-perm ${sort === s ? "on" : ""}`}
              onClick={() => setSort(s)}
            >
              {s === "active" ? "last active" : s}
            </button>
          ))}
        </div>
      </div>
      <section className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>email</th>
              <th>role</th>
              <th>permissions</th>
              <th>swipes</th>
              <th>saved</th>
              <th>last active</th>
              <th>joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.profileId} className={u.suspended ? "is-suspended" : ""}>
                <td>
                  <button
                    className="admin-user-link"
                    onClick={() =>
                      setSelected(selected === u.profileId ? null : u.profileId)
                    }
                    title="View details"
                  >
                    {u.email}
                  </button>
                  {u.suspended && <span className="admin-suspended">suspended</span>}
                </td>
                <td>
                  {isAdmin ? (
                    <button
                      className={`admin-role ${u.isAdmin ? "is-admin" : ""}`}
                      onClick={() => onSetAdmin(u.profileId, !u.isAdmin)}
                      title={u.isAdmin ? "Demote to member" : "Promote to admin"}
                    >
                      {u.isAdmin ? "admin" : "member"}
                    </button>
                  ) : u.isAdmin ? (
                    <span className="admin-chip">admin</span>
                  ) : (
                    "member"
                  )}
                </td>
                <td>
                  <div className="admin-perms">
                    {u.isAdmin ? (
                      <span className="admin-dim">all</span>
                    ) : (
                      data.allPermissions.map((p) => {
                        const has = u.permissions.includes(p);
                        return (
                          <button
                            key={p}
                            className={`admin-perm ${has ? "on" : ""}`}
                            disabled={!isAdmin}
                            onClick={() => onSetPermission(u.profileId, p, !has)}
                          >
                            {PERM_LABEL[p] ?? p}
                          </button>
                        );
                      })
                    )}
                  </div>
                </td>
                <td>{u.swipeCount}</td>
                <td>{u.savedCount}</td>
                <td>{timeAgo(u.lastActive)}</td>
                <td>{new Date(u.joined).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <p className="admin-dim">No users match.</p>}
      </section>
      {selected && (
        <UserDetailPanel
          profileId={selected as Id<"profiles">}
          isAdmin={isAdmin}
          canManage={data.canManage}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function UserDetailPanel({
  profileId,
  isAdmin,
  canManage,
  onClose,
}: {
  profileId: Id<"profiles">;
  isAdmin: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const detail = useQuery(api.admin.userDetail, { profileId });
  const setSuspended = useMutation(api.admin.setSuspended);
  const deleteUserData = useMutation(api.admin.deleteUserData);

  if (detail === undefined) return <section className="admin-panel">Loading…</section>;
  if (detail === null) return null;

  return (
    <motion.section
      className="admin-panel admin-detail"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="admin-detail-head">
        <h3>{detail.email}</h3>
        {detail.suspended && <span className="admin-suspended">suspended</span>}
        <span style={{ flex: 1 }} />
        {canManage && (
          <button
            className="admin-toggle"
            style={detail.suspended ? undefined : { color: "var(--more)" }}
            onClick={() =>
              void setSuspended({ profileId, suspended: !detail.suspended }).catch(
                (e: Error) => window.alert(e.message),
              )
            }
          >
            {detail.suspended ? "unsuspend" : "suspend"}
          </button>
        )}
        {isAdmin && (
          <button
            className="admin-toggle"
            style={{ color: "var(--never)" }}
            onClick={() => {
              if (
                window.confirm(
                  `Delete ALL data for ${detail.email}? Swipes, library, playlists and profile are wiped. This cannot be undone.`,
                )
              ) {
                void deleteUserData({ profileId })
                  .then(onClose)
                  .catch((e: Error) => window.alert(e.message));
              }
            }}
          >
            delete data
          </button>
        )}
        <button className="admin-toggle" onClick={onClose}>close</button>
      </div>
      <div className="admin-detail-stats">
        <span>{detail.byAction.save} saves</span>
        <span>{detail.byAction.skip} skips</span>
        <span>{detail.byAction.more} more-likes</span>
        <span>{detail.byAction.never} nevers</span>
        <span>{detail.savedCount} in library</span>
        <span>{detail.playlistCount} playlists</span>
      </div>
      <h4 className="admin-detail-sub">Recent swipes</h4>
      {detail.recentSwipes.length === 0 && <p className="admin-dim">No swipes yet.</p>}
      {detail.recentSwipes.map((s) => (
        <div className="admin-row" key={s._id}>
          <img src={art(s.artwork, 100)} alt="" />
          <div className="admin-row-meta">
            <strong>{s.title}</strong>
            <span>{s.artist}</span>
          </div>
          <span className="admin-dim">{timeAgo(s._creationTime)}</span>
          <span className="admin-action" style={{ color: ACTION_COLOR[s.action] }}>
            {s.action}
          </span>
        </div>
      ))}
    </motion.section>
  );
}

/* ---------------- catalog ---------------- */

type CatalogData = NonNullable<ReturnType<typeof useCatalogType>>;
function useCatalogType() {
  return useQuery(api.admin.catalog);
}

function CatalogPanel({
  catalog,
  onToggle,
  onBackfill,
}: {
  catalog: CatalogData;
  onToggle: (trackId: string, hidden: boolean) => void;
  onBackfill: () => void;
}) {
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("all");
  const [hiddenOnly, setHiddenOnly] = useState(false);

  const genres = useMemo(
    () => ["all", ...new Set(catalog.map((t) => t.genre))],
    [catalog],
  );
  const rows = useMemo(
    () =>
      catalog
        .filter(
          (t) =>
            (genre === "all" || t.genre === genre) &&
            (!hiddenOnly || t.hidden === true) &&
            `${t.title} ${t.artist}`.toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) => b.plays - a.plays),
    [catalog, search, genre, hiddenOnly],
  );

  return (
    <>
      <h2 className="admin-h2">Catalog</h2>
      <p className="admin-dim">
        {catalog.length} tracks. Hidden tracks disappear from everyone's feed
        instantly. Sorted by total plays.
      </p>
      <div className="admin-toolbar">
        <input
          className="admin-search"
          placeholder="search title or artist…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="admin-perm" onClick={onBackfill} title="Give three windows to any track that has none">
          fix hookless tracks
        </button>
        <select
          className="admin-select"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
        >
          {genres.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <button
          className={`admin-perm ${hiddenOnly ? "on" : ""}`}
          onClick={() => setHiddenOnly(!hiddenOnly)}
        >
          hidden only
        </button>
      </div>
      <section className="admin-panel">
        <div className="admin-catalog">
          {rows.map((t) => {
            const rate = t.plays > 0 ? Math.round((t.saves / t.plays) * 100) : 0;
            return (
              <div className={`admin-row ${t.hidden ? "is-hidden" : ""}`} key={t._id}>
                <img src={art(t.artwork, 100)} alt="" />
                <div className="admin-row-meta">
                  <strong>{t.title}</strong>
                  <span>
                    {t.artist} · {t.genre}
                  </span>
                </div>
                <div className="admin-track-stats">
                  <span title="total swipes">{t.plays} plays</span>
                  <span style={{ color: "var(--save)" }} title="saves">
                    {t.saves} ♥ ({rate}%)
                  </span>
                  <span style={{ color: "var(--never)" }} title="nevers">
                    {t.nevers} ✕
                  </span>
                </div>
                <button
                  className="admin-toggle"
                  onClick={() => onToggle(t.trackId, !t.hidden)}
                >
                  {t.hidden ? "unhide" : "hide"}
                </button>
              </div>
            );
          })}
          {rows.length === 0 && <p className="admin-dim">No tracks match.</p>}
        </div>
      </section>
    </>
  );
}

/* ---------------- feed ---------------- */

function FeedPanel({
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
function RequestsPanel({
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
