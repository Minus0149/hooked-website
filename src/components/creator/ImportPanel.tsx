/**
 * Paste a playlist and re-find each song on the open catalogues.
 *
 * Split out of CreatorDashboard.tsx, which held the apply form, the workspace,
 * the playlist importer and the per-track hook editor in one 688-line file.
 */
import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { parsePlaylist } from "../../lib/playlist-parse";
import type { ImportReport } from "../../../convex/imports";

const MAX_IMPORT = 40;
/** Roughly what one song costs to look up, so the wait can be predicted. */
const SECONDS_PER_SONG = 3.4;

const FORMAT_LABEL: Record<string, string> = {
  csv: "a spreadsheet export",
  lines: "a plain list",
  spotify: "Spotify links",
  empty: "nothing yet",
};

/**
 * Paste in a playlist and we re-find each song on Deezer and iTunes.
 *
 * Neither needs a key or an approved app, which is the point: Spotify won't
 * hand a new app more than 25 users or any preview audio at all, so the export
 * people can already make themselves is the way in.
 */
export function ImportPanel() {
  const beginImport = useMutation(api.imports.beginImport);
  const importPlaylist = useAction(api.imports.importPlaylist);
  const runs = useQuery(api.imports.myImports);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [titleFirst, setTitleFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const parsed = useMemo(() => parsePlaylist(text, { titleFirst }), [text, titleFirst]);
  const willImport = parsed.rows.slice(0, MAX_IMPORT);

  const run = async () => {
    if (busy || willImport.length === 0) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      // opening the run is where permission is checked; the action just matches
      const { importId, token } = await beginImport({
        playlistName: name.trim() || "Pasted playlist",
        source: parsed.rows.some((r) => r.spotifyId) ? "spotify" : "manual",
        total: willImport.length,
      });
      const result = await importPlaylist({
        importId,
        token,
        genre: genre.trim() || undefined,
        rows: willImport.map(({ title, artist, album }) => ({ title, artist, album })),
      });
      setReport(result);
      if (result.added > 0) setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That import didn't go through");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="aq-btn creator-add" onClick={() => setOpen(true)}>
        ↥ import a playlist
      </button>
    );
  }

  return (
    <section className="creator-import">
      <div className="creator-import-head">
        <h3>Import a playlist</h3>
        <button className="aq-btn" onClick={() => setOpen(false)}>close</button>
      </div>
      <p className="admin-dim">
        Export your playlist to CSV — <b>Exportify</b> for Spotify, <b>TuneMyMusic</b>{" "}
        for either, or File → Library → Export Playlist in the Music app — and paste
        it below. A plain <code>Artist - Title</code> list works too. Each song gets
        looked up again on Apple's catalogue for its artwork and 30-second preview,
        which takes about three seconds a song, so {MAX_IMPORT} at a time.
      </p>

      <textarea
        className="auth-input creator-paste"
        rows={7}
        placeholder={'"Track Name","Artist Name(s)",…\n\nor\n\nFred again.. - Delilah\nSZA - Snooze'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="creator-import-row">
        <input
          className="auth-input"
          placeholder="playlist name (for your records)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
        <input
          className="auth-input"
          placeholder="genre to fall back on"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          maxLength={40}
        />
        <label className="creator-check">
          <input
            type="checkbox"
            checked={titleFirst}
            onChange={(e) => setTitleFirst(e.target.checked)}
          />
          lines are Title – Artist
        </label>
      </div>

      {text.trim().length > 0 && (
        <div className="creator-parse">
          {parsed.format === "spotify" ? (
            <p className="creator-note">
              Those are bare Spotify links — they carry an id and nothing else, and
              reading it needs the API we can't get. In Exportify, tick{" "}
              <b>Track Name</b> and <b>Artist Name(s)</b> and paste the CSV instead.
            </p>
          ) : parsed.rows.length === 0 ? (
            <p className="creator-note">
              Couldn't find any songs in that. Each line needs an artist and a title,
              separated by a dash.
            </p>
          ) : (
            <>
              <p className="admin-dim">
                Read <b>{parsed.rows.length}</b> song{parsed.rows.length === 1 ? "" : "s"}{" "}
                from {FORMAT_LABEL[parsed.format]}
                {parsed.columns
                  ? ` (${parsed.columns.title} / ${parsed.columns.artist})`
                  : ""}
                {parsed.duplicates > 0 && ` · ${parsed.duplicates} duplicate dropped`}
                {parsed.skipped > 0 && ` · ${parsed.skipped} line skipped`}
                {parsed.rows.length > MAX_IMPORT &&
                  ` · only the first ${MAX_IMPORT} will run this time`}
              </p>
              <ul className="creator-preview">
                {willImport.slice(0, 6).map((r, i) => (
                  <li key={`${r.artist}-${r.title}-${i}`}>
                    <b>{r.artist}</b> — {r.title}
                  </li>
                ))}
                {willImport.length > 6 && <li>…and {willImport.length - 6} more</li>}
              </ul>
            </>
          )}
        </div>
      )}

      {error && <p className="access-error">{error}</p>}

      <div className="creator-row-actions">
        <button
          className="aq-btn yes"
          onClick={() => void run()}
          disabled={busy || willImport.length === 0}
        >
          {busy ? "matching…" : `import ${willImport.length || ""} song${willImport.length === 1 ? "" : "s"}`}
        </button>
        {busy ? (
          <span className="admin-dim">
            about {Math.ceil((willImport.length * SECONDS_PER_SONG) / 60)} minute
            {Math.ceil((willImport.length * SECONDS_PER_SONG) / 60) === 1 ? "" : "s"} —
            leave this tab open
          </span>
        ) : (
          willImport.length > 0 && (
            <span className="admin-dim">
              ~{Math.ceil((willImport.length * SECONDS_PER_SONG) / 60)} min
            </span>
          )
        )}
      </div>

      {report && (
        <div className="creator-report">
          <p>
            <b>{report.added}</b> added as drafts
            {report.already > 0 && ` · ${report.already} already in the catalogue`}
            {report.unmatched.length > 0 && ` · ${report.unmatched.length} not found`}
            {report.throttled && " · iTunes throttled us partway through"}
          </p>
          <p className="admin-dim">
            Everything lands hidden with one hook over the preview. Publish only what
            you have the rights to — that's the check this can't do for you.
          </p>
          {report.uncertain.length > 0 && (
            <>
              <h4 className="admin-detail-sub">Worth checking</h4>
              <ul className="creator-preview">
                {report.uncertain.map((u, i) => (
                  <li key={i}>
                    {u.artist} — {u.title} → matched <b>{u.matched}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
          {report.unmatched.length > 0 && (
            <>
              <h4 className="admin-detail-sub">Not found</h4>
              <p className="admin-dim">
                Usually a licensing gap rather than a typo — for some songs the
                original isn't in Apple's catalogue at all, only covers and remixes,
                and importing one of those under the wrong name is worse than
                skipping it. Add those by hand with your own audio.
              </p>
              <ul className="creator-preview">
                {report.unmatched.map((u, i) => (
                  <li key={i}>
                    {u.artist} — {u.title} <span className="admin-dim">({u.why})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {runs && runs.length > 0 && (
        <>
          <h4 className="admin-detail-sub">Past imports</h4>
          <ul className="creator-preview">
            {runs.map((r) => (
              <li key={r._id}>
                {new Date(r.createdAt).toLocaleDateString()} · <b>{r.playlistName}</b> ·{" "}
                {r.matched}/{r.total} matched
                {r.note ? ` · ${r.note}` : ""}
                {r.status === "failed" && " · failed"}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
