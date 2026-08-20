/**
 * Every track, and whether it is fit to be dealt.
 *
 * Split out of AdminDashboard.tsx, which had grown to 1290 lines holding
 * fourteen components — every change to one screen meant scrolling past six
 * others. The markup is deliberately unchanged: these screens need a signed-in
 * admin to look at, so restyling them blind would be guesswork. Each adopts the
 * shared primitives in ui/ as it is next worked on.
 */
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { art } from "../../lib/art";

type CatalogData = NonNullable<ReturnType<typeof useCatalogType>>;
function useCatalogType() {
  return useQuery(api.admin.catalog);
}

export function CatalogPanel({
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
