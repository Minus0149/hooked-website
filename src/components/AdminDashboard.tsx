import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "../lib/auth-client";
import type { Tab } from "./admin/shared";

type Group = "today" | "people" | "catalogue" | "system";
import { Overview } from "./admin/Overview";
import { AnalyticsPanel } from "./admin/Analytics";
import { RequestsPanel } from "./admin/Requests";
import { CreatorsPanel } from "./admin/Creators";
import { UsersPanel } from "./admin/Users";
import { CatalogPanel } from "./admin/Catalog";
import { AdsPanel } from "./admin/AdsPanel";
import { ConfigPanel } from "./admin/ConfigPanel";
import { ReportsPanel } from "./admin/ReportsPanel";
import { FeedPanel } from "./admin/Feed";
import { MoodsPanel } from "./admin/MoodsPanel";
import { useDialogs } from "./ui/Dialogs";

/**
 * The admin shell: which tabs this account may see, and the data each needs.
 *
 * Everything a tab actually draws lives in its own file. This used to be 1290
 * lines holding all fourteen components, which meant every change to one screen
 * meant scrolling past six others.
 */

export function AdminDashboard() {
  const { confirm, notify } = useDialogs();
  const session = authClient.useSession();
  const access = useQuery(api.admin.myAccess);
  const stats = useQuery(api.admin.stats);
  const userData = useQuery(api.admin.users);
  const catalog = useQuery(api.admin.catalog);
  const requests = useQuery(api.access.list);
  const analytics = useQuery(api.admin.analytics, {});
  const creatorData = useQuery(api.creators.listCreators);
  const moodSummary = useQuery(api.moods.adminSummary);
  const decideCreator = useMutation(api.creators.decideCreator);
  const decide = useMutation(api.access.decide);
  const markInvited = useMutation(api.access.markInvited);
  const removeRequest = useMutation(api.access.remove);
  const setHidden = useMutation(api.tracks.setHidden);
  const backfillHooks = useMutation(api.hooks.backfill);
  const setPermission = useMutation(api.admin.setPermission);
  const setAdmin = useMutation(api.admin.setAdmin);

  /**
   * Ten entries in one flat list is a list you read rather than scan. They
   * group naturally by what you came to do — check on today, deal with a
   * person, change the catalogue, or tune the machine — so the sidebar says
   * that out loud instead of making every visit a linear search.
   */
  const GROUPS: { id: Group; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "people", label: "People" },
    { id: "catalogue", label: "Catalogue" },
    { id: "system", label: "System" },
  ];

  const tabs = useMemo(() => {
    const t: { id: Tab; label: string; icon: string; group: Group }[] = [];
    if (stats !== null) t.push({ group: "today", id: "overview", label: "Overview", icon: "◈" });
    if (analytics !== null) t.push({ group: "system", id: "analytics", label: "Analytics", icon: "▤" });
    if (requests !== null) {
      const pending = requests?.pending ?? 0;
      t.push({ group: "people", id: "requests", label: pending ? `Requests (${pending})` : "Requests", icon: "✦" });
    }
    if (creatorData !== null) {
      const pending = creatorData?.pending ?? 0;
      t.push({ group: "people", id: "creators", label: pending ? `Creators (${pending})` : "Creators", icon: "✸" });
    }
    if (userData !== null) t.push({ group: "people", id: "users", label: "Users", icon: "◉" });
    if (catalog !== null) t.push({ group: "catalogue", id: "catalog", label: "Catalog", icon: "♪" });
    if (moodSummary !== null) t.push({ group: "catalogue", id: "moods", label: "Moods", icon: "◐" });
    if (access?.permissions.includes("ads.manage") || access?.isAdmin)
      t.push({ group: "catalogue", id: "ads", label: "Ads", icon: "▣" });
    if (access?.permissions.includes("config.manage") || access?.isAdmin)
      t.push({ group: "system", id: "config", label: "Config", icon: "⚙" });
    t.push({ group: "system", id: "reports", label: "Reports", icon: "⚠" });
    if (stats !== null) t.push({ group: "today", id: "feed", label: "Live feed", icon: "≋" });
    return t;
  }, [stats, userData, catalog, requests, analytics, creatorData, access, moodSummary]);

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
          {GROUPS.map((g) => {
            const inGroup = tabs.filter((t) => t.group === g.id);
            // a heading over nothing is worse than no heading — permissions
            // can empty a whole group for a staff account
            if (inGroup.length === 0) return null;
            return (
              <div key={g.id} className="admin-side-group">
                <span className="admin-side-label">{g.label}</span>
                {inGroup.map((t) => (
                  <button
                    key={t.id}
                    className={`admin-side-item ${activeTab === t.id ? "on" : ""}`}
                    onClick={() => setTab(t.id)}
                  >
                    <span className="admin-side-icon">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            );
          })}
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
        {activeTab === "moods" && moodSummary && <MoodsPanel summary={moodSummary} />}
        {activeTab === "analytics" && analytics && !("catalogue" in analytics) && (
          // a snapshot written before computeSnapshot awaited its payload holds
          // only a timestamp; reading it as a full one crashed the app
          <p className="admin-empty">
            The stored analytics snapshot is incomplete. Refresh it from Config, or wait
            for tonight's run.
          </p>
        )}
        {activeTab === "analytics" && analytics && "catalogue" in analytics && (
          <AnalyticsPanel a={analytics as import("./admin/Analytics").AnalyticsSnapshot} />
        )}
        {activeTab === "creators" && creatorData && (
          <CreatorsPanel
            data={creatorData}
            onDecide={(id, status) =>
              void decideCreator({ id: id as never, status }).catch((e: Error) =>
                notify(e.message, "error"),
              )
            }
          />
        )}
        {activeTab === "requests" && requests && (
          <RequestsPanel
            data={requests}
            onDecide={(id, status) =>
              void decide({ id: id as never, status }).catch((e: Error) => notify(e.message, "error"))
            }
            onInvited={(id, invited) =>
              void markInvited({ id: id as never, invited }).catch((e: Error) =>
                notify(e.message, "error"),
              )
            }
            onRemove={async (id, email) => {
              const ok = await confirm({
                title: `Remove the request from ${email}?`,
                body: "This deletes the row. Use it for spam and test submissions.",
                confirmLabel: "Remove",
                danger: true,
              });
              if (!ok) return;
              void removeRequest({ id: id as never }).catch((e: Error) => notify(e.message, "error"));
            }}
          />
        )}
        {activeTab === "users" && userData && (
          <UsersPanel
            data={userData}
            isAdmin={access?.isAdmin ?? false}
            onSetAdmin={(profileId, isAdmin) =>
              void setAdmin({ profileId: profileId as never, isAdmin }).catch((e: Error) =>
                notify(e.message, "error"),
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
                  notify(
                    r.tracksFilled === 0
                      ? "Every track already has a hook."
                      : `Gave ${r.tracksFilled} track${r.tracksFilled === 1 ? "" : "s"} ${r.hooksCreated} hooks between them.`,
                    "success",
                  ),
                )
                .catch((e: Error) => notify(e.message, "error"))
            }
          />
        )}
        {activeTab === "feed" && stats && <FeedPanel recent={stats.recent} />}
        {activeTab === "reports" && <ReportsPanel />}
        {activeTab === "ads" && <AdsPanel />}
        {activeTab === "config" && <ConfigPanel />}
      </motion.main>
    </div>
  );
}

/* ---------------- overview ---------------- */

