import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "../lib/auth-client";
import type { Id } from "../../convex/_generated/dataModel";
import { ImportPanel } from "./creator/ImportPanel";
import { TrackCard } from "./creator/TrackCard";
import type { Track } from "./creator/types";

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
