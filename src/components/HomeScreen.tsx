import { useEffect, useMemo, useRef } from "react";
import { motion } from "motion/react";
import { useStore } from "../state/store";
import type { Track } from "../types";
import { art } from "../lib/art";
import { IconHeart, IconFolder } from "./icons";
import { Face } from "./faces";
import { DAYPART_COPY, DAYPART_MOOD, daypartAt, moodsForHour } from "../data/mood";

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
  const { state, catalog, setMood } = useStore();
  const { liked, discoveries, playlists, boostGenres, queue } = state;

  /**
   * The faces, out in the open.
   *
   * The long press on a card is the fast way in and an invisible one — nothing
   * on screen says it exists. This row is where the feature is actually
   * discovered, and it answers a different question: not "what does this song
   * feel like" but "what do I want", which is the question somebody standing on
   * the home screen is already asking.
   *
   * Ordered by the hour, so at 1am the quiet faces come first. Ordering, not
   * filtering — every face is always there, because the clock is a guess about
   * a person and it is wrong for anyone working nights.
   */
  const hour = useMemo(() => {
    const part = daypartAt();
    return { part, moods: moodsForHour(), suggested: DAYPART_MOOD[part] };
  }, []);

  const becauseRows = useMemo(() => {
    // the same song reaching the screen twice reads as a glitch — dedupe by
    // normalized title+artist (catches chart+import twins with different ids)
    // and never deal a song that's already visible in the queue below
    const norm = (t: Track) =>
      `${t.title}·${t.artist}`.toLowerCase().replace(/\(.*?\)/g, "").trim();
    const queueIds = new Set(queue.map((t) => t.id));
    const genres =
      boostGenres.length > 0
        ? boostGenres
        : [...new Set(liked.map((t) => t.genre))].slice(0, 2);
    return genres
      .map((genre) => {
        const seen = new Set<string>();
        const tracks = catalog
          .filter(
            (t) =>
              t.genre === genre &&
              !liked.some((l) => l.id === t.id) &&
              !queueIds.has(t.id),
          )
          .filter((t) => {
            const key = norm(t);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 8);
        return { genre, tracks };
      })
      .filter((r) => r.tracks.length > 0);
  }, [boostGenres, liked, catalog, queue]);

  const fresh = useMemo(() => queue.slice(0, 10), [queue]);

  const mosaic = (tracks: Track[]) => {
    const cells = tracks.slice(0, 2);
    // a completely empty library reads better as ONE quiet heart than two
    // half-hearts pretending to be a collage
    if (cells.length === 0) {
      return (
        <div className="tile-mosaic">
          <div className="empty empty-solo">
            <IconHeart size={16} />
          </div>
        </div>
      );
    }
    return (
      <div className="tile-mosaic">
        {cells.map((t) => (
          <img key={t.id} src={art(t.artwork, 200)} alt="" />
        ))}
        {cells.length === 1 && (
          <div className="empty">
            <IconHeart size={16} />
          </div>
        )}
      </div>
    );
  };

  // The row holds all six faces and runs off the side of a phone, so the mood
  // you're in could be the one you can't see — pushed "tender" on a card, came
  // home, and the row showed Party ringed (the hour's suggestion) with Tender
  // scrolled away. The active chip is brought to the middle instead.
  const moodRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const row = moodRowRef.current;
    const on = row?.querySelector<HTMLElement>(".mood-chip.is-on");
    if (!row || !on) return;
    const r = row.getBoundingClientRect();
    const c = on.getBoundingClientRect();
    const left = row.scrollLeft + (c.left - r.left) - (row.clientWidth - c.width) / 2;
    row.scrollTo({ left: Math.max(0, left) });
  }, [state.mood]);

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

      <motion.section className="mood-section" variants={rise}>
        <div className="section-head">
          <h3 className="section-title">What&apos;s the mood?</h3>
        </div>
        <div className="mood-row" ref={moodRowRef}>
          {hour.moods.map((mood) => {
            const isOn = state.mood === mood.id;
            const isSuggested =
              state.prefs.moodByTime !== "off" && mood.id === hour.suggested;
            return (
              <button
                key={mood.id}
                type="button"
                className={`mood-chip${isOn ? " is-on" : ""}${isSuggested ? " is-suggested" : ""}`}
                style={{ ["--face" as string]: mood.accent }}
                onClick={() => {
                  setMood(mood.id);
                  onDiscover();
                }}
                aria-label={`${mood.label} — ${mood.line}`}
                title={mood.line}
              >
                <span className="mood-disc">
                  <Face mood={mood.id} size={30} />
                </span>
                <span className="mood-chip-label">{mood.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            className={`mood-chip mood-chip-any${state.mood === null ? " is-on" : ""}`}
            onClick={() => {
              setMood(null);
              onDiscover();
            }}
            title="No lens — the deck as it comes"
          >
            <span className="mood-disc">
              <span className="mood-any-mark" aria-hidden="true">∞</span>
            </span>
            <span className="mood-chip-label">Anything</span>
          </button>
        </div>
        {state.prefs.moodByTime !== "off" && (
          <span className="mood-nudge">{DAYPART_COPY[hour.part].nudge}</span>
        )}
      </motion.section>

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
