/**
 * One track: its audio, its hooks, and whether it is published.
 *
 * Split out of CreatorDashboard.tsx, which held the apply form, the workspace,
 * the playlist importer and the per-track hook editor in one 688-line file.
 */
import { useRef, useState } from "react";
import { motion } from "motion/react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Track } from "./types";
import { MS, clock, secs } from "./types";
import { HookEditor } from "./HookEditor";

export function TrackCard({ track }: { track: Track }) {
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

  // Mirrors the ordering in tracks.list, which reads the rank the hourly job
  // writes rather than recomputing from live counters.
  const leadingHookId =
    track.hooks.length > 1
      ? [...track.hooks]
          .filter((h) => h.active)
          .sort((a, b) => (a.rank ?? a.order) - (b.rank ?? b.order) || a.order - b.order)[0]
          ?._id
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
          The deck leads with whichever hook earns it, 20 plays minimum,
          worked out once an hour. Right now that's{" "}
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

      {canAddMore && (
        <>
          {/* drag the window onto the waveform and audition it in a loop —
              falls back to the number boxes when the audio can't be decoded */}
          {(track.audioUrl || track.previewUrl) && !error && (
            <HookEditor
              audioUrl={(track.audioUrl ?? track.previewUrl) as string}
              ceilingMs={ceilingMs}
              accent={track.accent}
              onAdd={async (startMs, durationMs) => {
                setError(null);
                try {
                  await upsertHook({ trackId: track.trackId, startMs, durationMs });
                  setNewLabel("");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not add that hook");
                }
              }}
            />
          )}
          <div className="creator-addhook">
            <input className="auth-input" type="number" min="0" step="0.5" placeholder="start (s)"
              value={newStart} onChange={(e) => setNewStart(e.target.value)} />
            <input className="auth-input" type="number" min="5" max="45" step="1" placeholder="length (s)"
              value={newLen} onChange={(e) => setNewLen(e.target.value)} />
            <input className="auth-input" placeholder="label — 'the drop' (optional)"
              value={newLabel} onChange={(e) => setNewLabel(e.target.value)} maxLength={40} />
            <button className="aq-btn yes" onClick={addHook}>+ hook</button>
          </div>
        </>
      )}
      {!canAddMore && (
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
