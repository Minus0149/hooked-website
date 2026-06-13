import { useState } from "react";
import { motion } from "motion/react";
import type { Playlist, SaveTarget } from "../types";
import { IconCheck, IconFolder, IconHeart } from "./icons";

const PLAYLIST_ACCENTS = ["#7C5CFF", "#00C2FF", "#FF6B35", "#E040FB", "#69F0AE", "#FFD740"];

export function SaveTargetSheet({
  value,
  playlists,
  onChange,
  onCreatePlaylist,
  onClose,
}: {
  value: SaveTarget;
  playlists: Playlist[];
  onChange: (t: SaveTarget) => void;
  onCreatePlaylist: (name: string, accent: string) => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = (t: SaveTarget) => {
    onChange(t);
    onClose();
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const accent = PLAYLIST_ACCENTS[playlists.length % PLAYLIST_ACCENTS.length];
    await onCreatePlaylist(trimmed, accent);
    setBusy(false);
    setName("");
  };

  return (
    <>
      <motion.div
        className="sheet-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="sheet"
        initial={{ y: "110%" }}
        animate={{ y: 0 }}
        exit={{ y: "110%" }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
      >
        <h3 className="sheet-title">Swipe down saves to…</h3>
        <p className="sheet-sub">Pick where a ↓ swipe sends the song.</p>

        <div className="sheet-options">
          <button
            className={`sheet-option ${value === "liked" ? "on" : ""}`}
            onClick={() => pick("liked")}
          >
            <span style={{ color: "var(--save)" }}><IconHeart /></span>
            Liked Songs
            <span className="check"><IconCheck /></span>
          </button>
          <button
            className={`sheet-option ${value === "discoveries" ? "on" : ""}`}
            onClick={() => pick("discoveries")}
          >
            <span style={{ color: "var(--more)" }}><IconFolder /></span>
            Discoveries playlist
            <span className="check"><IconCheck /></span>
          </button>
          {playlists.map((p) => (
            <button
              key={p.id}
              className={`sheet-option ${value === `pl:${p.id}` ? "on" : ""}`}
              onClick={() => pick(`pl:${p.id}`)}
            >
              <span style={{ color: p.accent }}><IconFolder /></span>
              {p.name}
              <span className="check"><IconCheck /></span>
            </button>
          ))}
        </div>

        <div className="sheet-create">
          <input
            className="auth-input"
            placeholder="new playlist name…"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
          <button
            className="sheet-create-btn"
            disabled={!name.trim() || busy}
            onClick={() => void create()}
          >
            {busy ? "…" : "create"}
          </button>
        </div>
      </motion.div>
    </>
  );
}
