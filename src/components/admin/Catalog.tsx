/**
 * Every track, and whether it is fit to be dealt — a page at a time.
 *
 * Split out of AdminDashboard.tsx, which had grown to 1290 lines holding
 * fourteen components. It used to receive the whole catalogue (every track
 * with its swipe counts) from the dashboard up front, which made opening the
 * tab read ~4 MB and sometimes hang for half a minute. It now loads 100 tracks
 * at a time, newest first, and the search box runs the title/artist search
 * indexes on the server instead of filtering an in-memory list.
 */
import { useEffect, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { art } from "../../lib/art";

const PAGE = 100;

export function CatalogPanel({
  onToggle,
  onBackfill,
}: {
  onToggle: (trackId: string, hidden: boolean) => void;
  onBackfill: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [hiddenOnly, setHiddenOnly] = useState(false);

  // wait for a pause in typing before asking the server
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(typed.trim()), 300);
    return () => window.clearTimeout(t);
  }, [typed]);

  const paged = usePaginatedQuery(
    api.admin.catalog,
    search ? "skip" : { hiddenOnly: hiddenOnly || undefined },
    { initialNumItems: PAGE },
  );
  const found = useQuery(api.admin.catalogSearch, search ? { search, hiddenOnly: hiddenOnly || undefined } : "skip");
  const results = search ? (found ?? []) : paged.results;
  const status = search ? (found === undefined ? "LoadingFirstPage" : "Exhausted") : paged.status;
  const loadMore = paged.loadMore;

  return (
    <>
      <h2 className="admin-h2">Catalog</h2>
      <p className="admin-dim">
        Newest first. Hidden tracks disappear from everyone's feed instantly.
        {search ? ` Searching titles and artists for “${search}”.` : ""}
      </p>
      <div className="admin-toolbar">
        <input
          className="admin-search"
          placeholder="search title or artist…"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button className="admin-perm" onClick={onBackfill} title="Give three windows to any track that has none">
          fix hookless tracks
        </button>
        <button
          className={`admin-perm ${hiddenOnly ? "on" : ""}`}
          onClick={() => setHiddenOnly(!hiddenOnly)}
        >
          hidden only
        </button>
      </div>
      <section className="admin-panel">
        <div className="admin-catalog">
          {status === "LoadingFirstPage" && <p className="admin-dim">Loading…</p>}
          {results.map((t) => {
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
                <button className="admin-toggle" onClick={() => onToggle(t.trackId, !t.hidden)}>
                  {t.hidden ? "unhide" : "hide"}
                </button>
              </div>
            );
          })}
          {status !== "LoadingFirstPage" && results.length === 0 && (
            <p className="admin-dim">No tracks match.</p>
          )}
          {status === "CanLoadMore" && (
            <button className="admin-perm" onClick={() => loadMore(PAGE)}>
              show {PAGE} more
            </button>
          )}
          {status === "LoadingMore" && <p className="admin-dim">Loading…</p>}
        </div>
      </section>
    </>
  );
}
