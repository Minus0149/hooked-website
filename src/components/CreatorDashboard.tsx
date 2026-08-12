import { useRef, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "../lib/auth-client";
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
  const ceilingMs = track.audioDurationMs ?? track.durationMs ?? 30_000;
  const canAddMore = hasFullAudio || track.hooks.length === 0;

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
              ? `full audio · ${clock(ceilingMs)} · unlimited hooks`
              : track.previewUrl
                ? "30s preview only · one hook"
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
          This track only has a 30-second preview, which is a single window. Upload the
          full audio to mark more than one hook.
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
