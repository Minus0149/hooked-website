import { motion } from "motion/react";
import { useStore } from "../state/store";
import type { LibraryContainer, Track } from "../types";
import { art } from "../lib/art";
import { IconBack, IconHeart, IconPlay, IconSparkle, IconX, IconFolder } from "./icons";

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } },
};
const rise = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 260, damping: 26 },
  },
};

function totalMinutes(tracks: Track[]) {
  // previews are ~30s each; show the full-song runtime for flavor
  const ms = tracks.reduce((sum, t) => sum + (t.durationMs || 0), 0);
  return Math.max(1, Math.round(ms / 60_000));
}

export function LibraryScreen({
  container,
  onBack,
  onPlay,
  onRemove,
  onDeletePlaylist,
  onDiscoverInto,
}: {
  container: LibraryContainer;
  onBack: () => void;
  onPlay: (trackId: string) => void;
  onRemove: (trackId: string) => void;
  onDeletePlaylist: (id: string) => void;
  onDiscoverInto: (container: LibraryContainer) => void;
}) {
  const { state } = useStore();

  let title: string;
  let tracks: Track[];
  let accent = "#FF3D71";
  let playlistId: string | null = null;
  let icon = <IconFolder size={15} />;

  if (container === "liked") {
    title = "Liked Songs";
    tracks = state.liked;
    accent = "#00E5A0";
    icon = <IconHeart size={15} />;
  } else if (container === "discoveries") {
    title = "Discoveries";
    tracks = state.discoveries;
    accent = "#FFB627";
  } else {
    playlistId = container.slice(3);
    const pl = state.playlists.find((p) => p.id === playlistId);
    title = pl?.name ?? "Playlist";
    tracks = pl?.tracks ?? [];
    accent = pl?.accent ?? accent;
  }

  const collage = tracks.slice(0, 4);
  const isSaveTarget =
    state.saveTarget === container ||
    (container === "liked" && state.saveTarget === "liked");

  return (
    <div className="library" style={{ "--pl-accent": accent } as React.CSSProperties}>
      <div className="library-hero-glow" />
      <header className="topbar">
        <button className="topbar-btn" onClick={onBack} aria-label="Back">
          <IconBack />
        </button>
        <span className="wordmark">
          hooked<span className="dot">.</span>
        </span>
        {playlistId ? (
          <button
            className="topbar-btn"
            style={{ color: "var(--never)" }}
            aria-label="Delete playlist"
            title="Delete playlist"
            onClick={() => {
              if (window.confirm(`Delete "${title}"? The songs leave your library too.`)) {
                onDeletePlaylist(playlistId!);
                onBack();
              }
            }}
          >
            <IconX size={16} />
          </button>
        ) : (
          <span style={{ width: 42 }} />
        )}
      </header>

      <motion.div
        className="library-body"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        <motion.div className="library-hero" variants={rise}>
          <div className="library-collage">
            {collage.map((t, i) => (
              <img key={t.id} src={art(t.artwork, 200)} alt="" style={{ rotate: `${(i % 2 ? 1 : -1) * (2 + i)}deg` }} />
            ))}
            {collage.length === 0 && (
              <div className="library-collage-empty">{icon}</div>
            )}
          </div>
          <div className="library-hero-meta">
            <span className="library-kicker">
              {icon}
              {playlistId ? "playlist" : "collection"}
              {isSaveTarget && <em>· saving here</em>}
            </span>
            <h2 className="library-title">{title}</h2>
            <p className="library-sub">
              {tracks.length} {tracks.length === 1 ? "song" : "songs"}
              {tracks.length > 0 && <> · ~{totalMinutes(tracks)} min of music</>}
            </p>
          </div>
        </motion.div>

        <motion.div className="library-actions" variants={rise}>
          <button
            className="library-cta"
            disabled={tracks.length === 0}
            onClick={() => tracks[0] && onPlay(tracks[0].id)}
          >
            <IconPlay size={16} /> Play
          </button>
          <button
            className="library-cta ghost"
            onClick={() => onDiscoverInto(container)}
            title="New discoveries get saved straight into this"
          >
            <IconSparkle size={15} /> Discover into this
          </button>
        </motion.div>

        {tracks.length === 0 ? (
          <motion.div className="library-empty" variants={rise}>
            <p>
              Nothing in here yet. Hit <strong>Discover into this</strong> — every
              song you swipe down will land right here.
            </p>
          </motion.div>
        ) : (
          tracks.map((t, i) => (
            <motion.div className="library-row" key={t.id} variants={rise}>
              <span className="library-index">{String(i + 1).padStart(2, "0")}</span>
              <button className="library-row-main" onClick={() => onPlay(t.id)}>
                <span className="library-art-wrap">
                  <img src={art(t.artwork, 100)} alt="" />
                  <span className="library-art-play"><IconPlay size={13} /></span>
                </span>
                <span className="list-meta library-row-meta">
                  <span className="list-title">{t.title}</span>
                  <span className="list-artist">{t.artist}</span>
                </span>
              </button>
              <span className="library-genre">{t.genre}</span>
              <button
                className="library-row-btn danger"
                onClick={() => onRemove(t.id)}
                aria-label={`Remove ${t.title}`}
              >
                <IconX size={13} />
              </button>
            </motion.div>
          ))
        )}
        <div style={{ height: 10 }} />
      </motion.div>
    </div>
  );
}
