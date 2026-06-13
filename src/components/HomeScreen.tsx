import { useMemo } from "react";
import { motion } from "motion/react";
import { useStore } from "../state/store";
import type { Track } from "../types";
import { art } from "../lib/art";
import { IconHeart, IconFolder } from "./icons";

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};
const rise = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 240, damping: 24 } },
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "up late";
  if (h < 12) return "good morning";
  if (h < 18) return "good afternoon";
  return "good evening";
}

function TrackRow({ track, onPick }: { track: Track; onPick: (id: string) => void }) {
  return (
    <button className="row-card" onClick={() => onPick(track.id)}>
      <img className="row-art" src={art(track.artwork, 300)} alt={track.album} />
      <div className="row-title">{track.title}</div>
      <div className="row-artist">{track.artist}</div>
    </button>
  );
}

export function HomeScreen({
  onDiscover,
  onOpenLibrary,
  onNewPlaylist,
}: {
  onDiscover: (trackId?: string) => void;
  onOpenLibrary: (container: string) => void;
  onNewPlaylist: () => void;
}) {
  const { state, catalog } = useStore();
  const { liked, discoveries, playlists, boostGenres, queue } = state;

  const becauseRows = useMemo(() => {
    const genres =
      boostGenres.length > 0
        ? boostGenres
        : [...new Set(liked.map((t) => t.genre))].slice(0, 2);
    return genres
      .map((genre) => ({
        genre,
        tracks: catalog
          .filter((t) => t.genre === genre && !liked.some((l) => l.id === t.id))
          .slice(0, 8),
      }))
      .filter((r) => r.tracks.length > 0);
  }, [boostGenres, liked, catalog]);

  const fresh = useMemo(() => queue.slice(0, 10), [queue]);

  const mosaic = (tracks: Track[]) => {
    const cells = tracks.slice(0, 2);
    return (
      <div className="tile-mosaic">
        {cells.map((t) => (
          <img key={t.id} src={art(t.artwork, 200)} alt="" />
        ))}
        {Array.from({ length: 2 - cells.length }).map((_, i) => (
          <div key={i} className="empty">
            <IconHeart size={16} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <motion.div className="home" variants={stagger} initial="hidden" animate="show">
      <motion.p className="home-greeting" variants={rise}>{greeting()}</motion.p>
      <motion.h1 className="home-title" variants={rise}>
        what's your next <em>obsession?</em>
      </motion.h1>

      <motion.button className="cta" variants={rise} whileTap={{ scale: 0.97 }} onClick={() => onDiscover()}>
        <div>
          <div className="cta-label">Start discovering</div>
          <div className="cta-sub">
            {queue.length} songs queued for you
          </div>
        </div>
        <span className="eq">
          <span /><span /><span /><span />
        </span>
      </motion.button>

      <motion.div className="section-head" variants={rise}>
        <h3 className="section-title">Your library</h3>
        <button className="section-action" onClick={onNewPlaylist}>
          + new playlist
        </button>
      </motion.div>
      <motion.div className="tiles" variants={rise}>
        <button className="tile" onClick={() => onOpenLibrary("liked")}>
          {mosaic(liked)}
          <div className="tile-name">Liked Songs</div>
          <div className="tile-sub">
            {liked.length} {liked.length === 1 ? "song" : "songs"}
          </div>
        </button>
        <button className="tile" onClick={() => onOpenLibrary("discoveries")}>
          {mosaic(discoveries)}
          <div className="tile-name">Discoveries</div>
          <div className="tile-sub">
            {discoveries.length} {discoveries.length === 1 ? "song" : "songs"}
          </div>
        </button>
        {playlists.map((p) => (
          <button
            key={p.id}
            className="tile"
            onClick={() => onOpenLibrary(`pl:${p.id}`)}
            style={{ borderColor: `color-mix(in srgb, ${p.accent} 45%, var(--line))` }}
          >
            {mosaic(p.tracks)}
            <div className="tile-name">{p.name}</div>
            <div className="tile-sub">
              {p.tracks.length} {p.tracks.length === 1 ? "song" : "songs"}
            </div>
          </button>
        ))}
      </motion.div>

      {becauseRows.map((row) => (
        <motion.section key={row.genre} variants={rise}>
          <div className="section-head">
            <h3 className="section-title">
              Because you wanted more <em style={{ color: "var(--accent)", fontStyle: "normal" }}>{row.genre}</em>
            </h3>
          </div>
          <div className="row-scroll">
            {row.tracks.map((t) => (
              <TrackRow key={t.id} track={t} onPick={(id) => onDiscover(id)} />
            ))}
          </div>
        </motion.section>
      ))}

      <motion.div className="section-head" variants={rise}>
        <h3 className="section-title">Fresh for you</h3>
        <span className="section-count">tap to play</span>
      </motion.div>
      <motion.div className="row-scroll" variants={rise}>
        {fresh.map((t) => (
          <TrackRow key={t.id} track={t} onPick={(id) => onDiscover(id)} />
        ))}
      </motion.div>

      {liked.length > 0 && (
        <motion.div variants={rise}>
          <div className="section-head">
            <h3 className="section-title">
              <IconFolder size={14} /> Recently saved
            </h3>
          </div>
          {liked.slice(0, 5).map((t) => (
            <button className="list-row" key={t.id} onClick={() => onDiscover(t.id)}>
              <img src={art(t.artwork, 100)} alt="" />
              <div className="list-meta">
                <div className="list-title">{t.title}</div>
                <div className="list-artist">{t.artist}</div>
              </div>
              <IconHeart size={16} strokeWidth={2} />
            </button>
          ))}
        </motion.div>
      )}
      <div style={{ height: 8 }} />
    </motion.div>
  );
}
