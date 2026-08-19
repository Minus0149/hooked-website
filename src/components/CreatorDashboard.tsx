import { useMemo, useRef, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "../lib/auth-client";
import { parsePlaylist } from "../lib/playlist-parse";
import type { ImportReport } from "../../convex/imports";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * The creator dashboard.
 *
 * The rule the whole screen is built around: a hook is a *window* into audio, so
 * how many hooks a track can have depends entirely on how much audio we hold. A
 * 30-second preview is one window. A full uploaded track is as many as the
 * artist wants. The UI says so rather than letting someone find out by failing.
 */

const MS = (s: number) => Math.round(s * 1000);
const secs = (ms: number) => (ms / 1000).toFixed(1).replace(/\.0$/, "");
const clock = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

type Hook = {
  _id: Id<"hooks">;
  startMs: number;
  durationMs: number;
  label?: string;
  order: number;
  active: boolean;
  plays: number;
  saves: number;
  skips: number;
};

type Track = {
  _id: Id<"tracks">;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  previewUrl: string;
  durationMs: number;
  genre: string;
  accent: string;
  hidden?: boolean;
  audioUrl: string | null;
  audioDurationMs?: number;
  hooks: Hook[];
};

export function CreatorDashboard() {
  const data = useQuery(api.creators.dashboard);
  const apply = useMutation(api.creators.apply);
  const session = authClient.useSession();

  const [artistName, setArtistName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (data === undefined) {
    return <div className="admin admin-v2"><p className="admin-empty">Loading…</p></div>;
  }

  if (!session.data) {
    return (
      <div className="admin admin-v2">
        <div className="admin-empty">
          <p>Sign in first — the creator dashboard is tied to your account.</p>
          <a className="admin-back" href="#/">← back to the app</a>
        </div>
      </div>
    );
  }

  // not a creator yet, and not a curator → the application form
  if (!data.creator && !data.curator) {
    const submit = async (e: FormEvent) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await apply({ artistName: artistName.trim(), bio: bio.trim() || undefined });
      } catch (err) {
        setError(err instanceof Error ? err.message : "That didn't go through");
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="admin admin-v2">
        <div className="creator-apply">
          <h2>put your own music in the deck</h2>
          <p>
            Upload a track, mark two or three hooks in it, and every listener gets more
            than one chance to fall for it. Approved by hand, so tell us who you are.
          </p>
          <form onSubmit={submit}>
            <input
              className="auth-input"
              placeholder="the name you release under"
              value={artistName}
              onChange={(e) => setArtistName(e.target.value)}
              maxLength={60}
              required
            />
            <textarea
              className="auth-input"
              placeholder="anything else — links, what you make (optional)"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={400}
            />
            {error && <p className="access-error">{error}</p>}
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? "sending…" : "apply as a creator"}
            </button>
          </form>
          <a className="admin-back" href="#/">← back to the app</a>
        </div>
      </div>
    );
  }

  if (data.creator && data.creator.status !== "approved" && !data.curator) {
    const rejected = data.creator.status === "rejected";
    return (
      <div className="admin admin-v2">
        <div className="creator-apply">
          <i className="access-dot" />
          <h2>{rejected ? "not this round" : "thank you for your interest"}</h2>
          <p>
            {rejected
              ? "Your creator application wasn't approved for this round."
              : "We'll get back to you. Once you're approved, this page becomes your dashboard."}
          </p>
          <a className="admin-back" href="#/">← back to the app</a>
        </div>
      </div>
    );
  }

  return <CreatorWorkspace tracks={data.tracks as Track[]} curator={data.curator} />;
}

function CreatorWorkspace({ tracks, curator }: { tracks: Track[]; curator: boolean }) {
  const createTrack = useMutation(api.creators.createTrack);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", artist: "", genre: "", artwork: "" });
  const [error, setError] = useState<string | null>(null);

  const totals = tracks.reduce(
    (acc, t) => {
      for (const h of t.hooks) {
        acc.plays += h.plays;
        acc.saves += h.saves;
        acc.skips += h.skips;
        acc.hooks += 1;
      }
      if (!t.hidden) acc.live += 1;
      return acc;
    },
    { plays: 0, saves: 0, skips: 0, hooks: 0, live: 0 },
  );
  const saveRate = totals.plays ? Math.round((totals.saves / totals.plays) * 100) : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createTrack({
        title: form.title.trim(),
        artist: form.artist.trim(),
        genre: form.genre.trim() || "unsorted",
        artwork: form.artwork.trim(),
      });
      setForm({ title: "", artist: "", genre: "", artwork: "" });
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that");
    }
  };

  return (
    <div className="admin admin-v2 creator-wrap">
      <header className="admin-head">
        <h2>{curator ? "Catalogue" : "Your music"}</h2>
        <p>
          {tracks.length} track{tracks.length === 1 ? "" : "s"} · {totals.live} live ·{" "}
          {totals.hooks} hook{totals.hooks === 1 ? "" : "s"} · {totals.plays} plays ·{" "}
          {saveRate}% save rate
        </p>
      </header>

      <ImportPanel />

      {!adding ? (
        <button className="aq-btn yes creator-add" onClick={() => setAdding(true)}>
          + add a track
        </button>
      ) : (
        <form className="creator-newtrack" onSubmit={submit}>
          <input className="auth-input" placeholder="title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} />
          <input className="auth-input" placeholder="artist" value={form.artist}
            onChange={(e) => setForm({ ...form, artist: e.target.value })} required maxLength={60} />
          <input className="auth-input" placeholder="genre" value={form.genre}
            onChange={(e) => setForm({ ...form, genre: e.target.value })} maxLength={40} />
          <input className="auth-input" placeholder="artwork url (https)" value={form.artwork}
            onChange={(e) => setForm({ ...form, artwork: e.target.value })} maxLength={500} />
          {error && <p className="access-error">{error}</p>}
          <div className="creator-row-actions">
            <button className="aq-btn yes" type="submit">add</button>
            <button className="aq-btn" type="button" onClick={() => setAdding(false)}>cancel</button>
          </div>
        </form>
      )}

      {tracks.length === 0 && <p className="aq-empty">Nothing here yet. Add a track to start.</p>}
      {tracks.map((track) => (
        <TrackCard key={track._id} track={track} />
      ))}
    </div>
  );
}

/* ---------------- playlist import ---------------- */

/** Must match MAX_ROWS in convex/imports.ts — the run is capped server-side. */
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
function ImportPanel() {
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

function TrackCard({ track }: { track: Track }) {
  const generateUploadUrl = useMutation(api.creators.generateUploadUrl);
  const attachAudio = useMutation(api.creators.attachAudio);
  const upsertHook = useMutation(api.creators.upsertHook);
  const deleteHook = useMutation(api.creators.deleteHook);
  const setHidden = useMutation(api.creators.setTrackHidden);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newStart, setNewStart] = useState("");
  const [newLen, setNewLen] = useState("20");
  const [newLabel, setNewLabel] = useState("");

  const hasFullAudio = !!track.audioUrl;
  // Without an upload, only the 30s preview is playable — the song's own length
  // would draw the hook bar against time nobody can hear.
  const ceilingMs = hasFullAudio ? (track.audioDurationMs ?? track.durationMs ?? 30_000) : 30_000;
  // A preview holds three 10s windows comfortably; the server rejects anything
  // that runs past the end of the audio, so the only cap here is the count.
  const canAddMore = track.hooks.length < (hasFullAudio ? 6 : 3);

  // Mirrors the ordering in tracks.list: enough plays to mean something, best
  // save rate wins, otherwise the creator's own order stands.
  const leadingHookId =
    track.hooks.length > 1
      ? [...track.hooks]
          .filter((h) => h.active)
          .sort(
            (a, b) =>
              (b.plays >= 20 ? b.saves / b.plays : -1) -
                (a.plays >= 20 ? a.saves / a.plays : -1) || a.order - b.order,
          )[0]?._id
      : null;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      // read the real duration in the browser — the server has no decoder
      const durationMs = await new Promise<number>((resolve, reject) => {
        const audio = new Audio();
        audio.preload = "metadata";
        audio.onloadedmetadata = () => resolve(Math.round(audio.duration * 1000));
        audio.onerror = () => reject(new Error("Couldn't read that audio file"));
        audio.src = URL.createObjectURL(file);
      });
      const url = await generateUploadUrl({});
      const res = await fetch(url, { method: "POST", headers: { "content-type": file.type }, body: file });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await attachAudio({ trackId: track.trackId, storageId, audioDurationMs: durationMs });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const addHook = async () => {
    setError(null);
    try {
      await upsertHook({
        trackId: track.trackId,
        startMs: MS(parseFloat(newStart || "0")),
        durationMs: MS(parseFloat(newLen || "20")),
        label: newLabel.trim() || undefined,
      });
      setNewStart("");
      setNewLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that hook");
    }
  };

  const publish = async (hidden: boolean) => {
    setError(null);
    try {
      await setHidden({ trackId: track.trackId, hidden });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change that");
    }
  };

  return (
    <motion.div className="creator-track" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="creator-track-head">
        {track.artwork
          ? <img src={track.artwork} alt="" className="creator-art" />
          : <div className="creator-art creator-art-blank" style={{ background: track.accent }} />}
        <div className="creator-track-meta">
          <strong>{track.title}</strong>
          <span>{track.artist}{track.genre ? ` · ${track.genre}` : ""}</span>
          <span className="creator-audio-state">
            {hasFullAudio
              ? `full audio · ${clock(ceilingMs)} · up to 6 hooks`
              : track.previewUrl
                ? `30s preview · ${track.hooks.length}/3 hooks`
                : "no audio yet"}
          </span>
        </div>
        <div className="creator-track-actions">
          <span className={track.hidden ? "aq-tag pending" : "aq-tag approved"}>
            {track.hidden ? "draft" : "live"}
          </span>
          <button className={track.hidden ? "aq-btn yes" : "aq-btn"} onClick={() => publish(!track.hidden)}>
            {track.hidden ? "publish" : "unpublish"}
          </button>
        </div>
      </div>

      {/* the dots the listener will see, previewed here */}
      {track.hooks.length > 0 && (
        <div className="creator-dots" aria-hidden="true">
          {track.hooks.map((h) => (
            <span key={h._id} className={h.active ? "creator-dot on" : "creator-dot"} />
          ))}
        </div>
      )}

      {leadingHookId && (
        <p className="creator-leading">
          The deck plays the best-performing hook first once it has 20 plays to
          judge by — right now that's{" "}
          <b>
            {track.hooks.find((h) => h._id === leadingHookId)?.label ||
              `hook ${(track.hooks.findIndex((h) => h._id === leadingHookId) ?? 0) + 1}`}
          </b>
          .
        </p>
      )}

      <div className="creator-hooks">
        {track.hooks.map((hook) => {
          const rate = hook.plays ? Math.round((hook.saves / hook.plays) * 100) : null;
          return (
            <div className="creator-hook" key={hook._id}>
              <div className="creator-hook-bar">
                <span
                  className="creator-hook-fill"
                  style={{
                    left: `${Math.min(100, (hook.startMs / Math.max(ceilingMs, 1)) * 100)}%`,
                    width: `${Math.min(100, (hook.durationMs / Math.max(ceilingMs, 1)) * 100)}%`,
                    background: track.accent,
                  }}
                />
              </div>
              <div className="creator-hook-meta">
                <strong>{hook.label || `hook ${hook.order + 1}`}</strong>
                <span>{clock(hook.startMs)} → {clock(hook.startMs + hook.durationMs)} · {secs(hook.durationMs)}s</span>
                <span className="creator-hook-stats">
                  {hook.plays} plays · {hook.saves} saves · {hook.skips} skips
                  {rate !== null && <b> · {rate}% save rate</b>}
                </span>
              </div>
              <div className="creator-row-actions">
                <button
                  className="aq-btn"
                  onClick={() => void upsertHook({
                    trackId: track.trackId, hookId: hook._id,
                    startMs: hook.startMs, durationMs: hook.durationMs, active: !hook.active,
                  }).catch((e: Error) => setError(e.message))}
                >
                  {hook.active ? "mute" : "unmute"}
                </button>
                <button className="aq-btn no" onClick={() => void deleteHook({ hookId: hook._id })}>
                  delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {canAddMore ? (
        <div className="creator-addhook">
          <input className="auth-input" type="number" min="0" step="0.5" placeholder="start (s)"
            value={newStart} onChange={(e) => setNewStart(e.target.value)} />
          <input className="auth-input" type="number" min="5" max="45" step="1" placeholder="length (s)"
            value={newLen} onChange={(e) => setNewLen(e.target.value)} />
          <input className="auth-input" placeholder="label — 'the drop' (optional)"
            value={newLabel} onChange={(e) => setNewLabel(e.target.value)} maxLength={40} />
          <button className="aq-btn yes" onClick={addHook}>+ hook</button>
        </div>
      ) : (
        <p className="creator-note">
          {hasFullAudio
            ? "Six hooks is plenty for one song."
            : "That's every window a 30-second preview holds. Upload the full track to cut hooks from anywhere in the song."}
        </p>
      )}

      <div className="creator-upload">
        <label className="aq-btn">
          {uploading ? "uploading…" : hasFullAudio ? "replace audio" : "upload full track"}
          <input ref={fileRef} type="file" accept="audio/*" onChange={onFile} hidden disabled={uploading} />
        </label>
        {hasFullAudio && track.audioUrl && (
          <audio controls preload="none" src={track.audioUrl} className="creator-audio" />
        )}
      </div>

      {error && <p className="access-error">{error}</p>}
    </motion.div>
  );
}
