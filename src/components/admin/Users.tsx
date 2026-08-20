/**
 * Everyone with an account, and what each has done.
 *
 * Split out of AdminDashboard.tsx, which had grown to 1290 lines holding
 * fourteen components — every change to one screen meant scrolling past six
 * others. The markup is deliberately unchanged: these screens need a signed-in
 * admin to look at, so restyling them blind would be guesswork. Each adopts the
 * shared primitives in ui/ as it is next worked on.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { art } from "../../lib/art";
import { ACTION_COLOR, PERM_LABEL, timeAgo } from "./shared";

type UsersData = NonNullable<ReturnType<typeof useUsersType>>;
function useUsersType() {
  return useQuery(api.admin.users);
}

export function UsersPanel({
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
