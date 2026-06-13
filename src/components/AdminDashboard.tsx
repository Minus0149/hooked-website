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

type Tab = "overview" | "users" | "catalog" | "feed";

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
  const setHidden = useMutation(api.tracks.setHidden);
  const setPermission = useMutation(api.admin.setPermission);
  const setAdmin = useMutation(api.admin.setAdmin);

  const tabs = useMemo(() => {
    const t: { id: Tab; label: string; icon: string }[] = [];
    if (stats !== null) t.push({ id: "overview", label: "Overview", icon: "◈" });
    if (userData !== null) t.push({ id: "users", label: "Users", icon: "◉" });
    if (catalog !== null) t.push({ id: "catalog", label: "Catalog", icon: "♪" });
    if (stats !== null) t.push({ id: "feed", label: "Live feed", icon: "≋" });
    return t;
  }, [stats, userData, catalog]);

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
}: {
  catalog: CatalogData;
  onToggle: (trackId: string, hidden: boolean) => void;
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
