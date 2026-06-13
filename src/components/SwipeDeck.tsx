import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "motion/react";
import type { SwipeDir, Track } from "../types";
import { gesture } from "../design/tokens";
import { DiscFX, type SaveFxData, type SaveRelease } from "./DiscFX";
import {
  IconHeart,
  IconPause,
  IconPlay,
  IconSkipUp,
  IconSparkle,
  IconX,
} from "./icons";

interface Props {
  tracks: Track[]; // [onDeck, next, nextNext]
  backToken: number; // bumped by ↩ — cancels any in-flight save FX
  playing: boolean;
  progress: number;
  remaining: number; // seconds left in the preview
  saveTarget: string;
  onToggle: () => void;
  onSeek: (fraction: number) => void;
  onSwipe: (dir: SwipeDir) => void;
  // return false to refuse the swipe (login gate) — card snaps back, no FX
  gateSwipe?: (dir: SwipeDir) => boolean;
}

export function resolveDir(info: PanInfo): SwipeDir | null {
  const { offset, velocity } = info;
  const absX = Math.abs(offset.x);
  const absY = Math.abs(offset.y);
  const committedByDistance = Math.max(absX, absY) > gesture.commitDistance;
  const committedByFlick =
    Math.max(Math.abs(velocity.x), Math.abs(velocity.y)) > gesture.commitVelocity;
  if (!committedByDistance && !committedByFlick) return null;
  // require a clearly dominant axis so diagonal drags spring back
  if (absX > absY * gesture.axisDominance) return offset.x > 0 ? "right" : "left";
  if (absY > absX * gesture.axisDominance) return offset.y > 0 ? "down" : "up";
  return null;
}

const EXIT: Record<SwipeDir, { x: number; y: number; rotate: number; scale: number }> = {
  up: { x: 0, y: -760, rotate: 0, scale: 1 },
  down: { x: 0, y: 760, rotate: 0, scale: 1 }, // unused — "down" has its own sleeve path
  right: { x: 520, y: -40, rotate: 18, scale: 1 },
  left: { x: -520, y: -40, rotate: -18, scale: 1 },
};

interface ExitCustom {
  dir: SwipeDir;
  deckH: number;
}

const cardVariants = {
  enter: { scale: 0.94, y: 14, opacity: 0.6 },
  center: { scale: 1, y: 0, opacity: 1 },
  exit: (custom: ExitCustom | undefined) => {
    const dir = custom?.dir ?? "up";
    if (dir === "down") {
      // the DiscFX overlay takes over from the exact release pose —
      // the real card just vanishes underneath it
      return { opacity: 0, transition: { duration: 0.01 } };
    }
    return {
      ...EXIT[dir],
      opacity: 0,
      transition: { duration: 0.32, ease: "easeOut" as const },
    };
  },
};

/* ---------- swipe FX overlays ---------- */

type FX = { type: "more" | "never"; key: number };

/** Draggable/clickable scrub bar along the card's bottom edge. */
function ScrubBar({
  progress,
  onSeek,
}: {
  progress: number;
  onSeek: (fraction: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seekFromEvent = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    onSeek((clientX - rect.left) / rect.width);
  };
  return (
    <div
      ref={ref}
      className="scrub"
      onPointerDown={(e) => {
        e.stopPropagation(); // don't start a card drag from the scrubber
        e.currentTarget.setPointerCapture(e.pointerId);
        seekFromEvent(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons > 0) {
          e.stopPropagation();
          seekFromEvent(e.clientX);
        }
      }}
    >
      <div className="scrub-track" />
      <div className="scrub-fill" style={{ width: `${progress * 100}%` }} />
      <div className="scrub-knob" style={{ left: `${progress * 100}%` }} />
    </div>
  );
}

/** Links out to where the track can legally play in full. */
function FullSongSheet({ track, onClose }: { track: Track; onClose: () => void }) {
  const q = encodeURIComponent(`${track.title} ${track.artist}`);
  const services = [
    { name: "Apple Music", href: `https://music.apple.com/us/song/${track.id}` },
    { name: "Spotify", href: `https://open.spotify.com/search/${q}` },
    { name: "YouTube", href: `https://www.youtube.com/results?search_query=${q}` },
  ];
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
        <h3 className="sheet-title">Hear the whole thing</h3>
        <p className="sheet-sub">
          "{track.title}" — {track.artist}. Previews stop at 30 seconds; pick where
          to keep listening.
        </p>
        {services.map((s) => (
          <a
            key={s.name}
            className="sheet-option"
            href={s.href}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
          >
            <span style={{ color: "var(--accent)" }}>♪</span>
            {s.name}
            <span className="check" style={{ opacity: 1 }}>↗</span>
          </a>
        ))}
      </motion.div>
    </>
  );
}

function SparkleFX() {
  const parts = Array.from({ length: 7 }, (_, i) => ({
    dx: 60 + Math.random() * 140,
    dy: (Math.random() - 0.5) * 180,
    rot: (Math.random() - 0.5) * 220,
    delay: i * 0.03,
    size: 13 + Math.random() * 13,
  }));
  return (
    <>
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="sparkle"
          style={{ fontSize: p.size }}
          initial={{ opacity: 0, x: 0, y: 0, scale: 1 }}
          animate={{ opacity: [0, 1, 0], x: p.dx, y: p.dy, scale: 0.3, rotate: p.rot }}
          transition={{ duration: 0.6, delay: p.delay, ease: "easeOut" }}
        >
          ✦
        </motion.span>
      ))}
    </>
  );
}

function NeverFlashFX() {
  return (
    <motion.div
      className="never-flash"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.45, 0] }}
      transition={{ duration: 0.45 }}
    />
  );
}

function TopCard({
  track,
  playing,
  progress,
  exitCustom,
  onSeek,
  onSwipe,
}: {
  track: Track;
  playing: boolean;
  progress: number;
  exitCustom: ExitCustom;
  onSeek: (fraction: number) => void;
  onSwipe: (dir: SwipeDir, release?: SaveRelease) => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-13, 13]);

  const upOpacity = useTransform(y, [-110, -36], [1, 0]);
  const downOpacity = useTransform(y, [36, 110], [0, 1]);
  const rightOpacity = useTransform(x, [36, 110], [0, 1]);
  const leftOpacity = useTransform(x, [-110, -36], [1, 0]);

  return (
    <motion.div
      className="card is-top"
      style={{ x, y, rotate }}
      drag
      dragSnapToOrigin
      dragElastic={0.7}
      whileDrag={{ scale: 1.02 }}
      onDragEnd={(_, info) => {
        const dir = resolveDir(info);
        if (dir)
          onSwipe(dir, {
            x: x.get(),
            y: y.get(),
            vx: info.velocity.x,
            vy: info.velocity.y,
          });
      }}
      variants={cardVariants}
      custom={exitCustom}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
    >
      <img className="card-art" src={track.artwork} alt={track.album} draggable={false} />
      <div className="card-scrim" />

      <motion.div className="stamp stamp-up" style={{ opacity: upOpacity }}>
        skip ↑
      </motion.div>
      <motion.div className="stamp stamp-down" style={{ opacity: downOpacity }}>
        ♥ saved
      </motion.div>
      <motion.div className="stamp stamp-right" style={{ opacity: rightOpacity }}>
        ✦ more like this
      </motion.div>
      <motion.div className="stamp stamp-left" style={{ opacity: leftOpacity }}>
        ✕ never
      </motion.div>

      <div className="card-meta">
        <span className="card-genre">{track.genre}</span>
        <h2 className="card-title">{track.title}</h2>
        <p className="card-artist">
          <span className={`eq ${playing ? "" : "paused"}`}>
            <span /><span /><span /><span />
          </span>
          {track.artist}
        </p>
      </div>
      <ScrubBar progress={progress} onSeek={onSeek} />
    </motion.div>
  );
}

export function SwipeDeck({
  tracks,
  backToken,
  playing,
  progress,
  remaining,
  saveTarget,
  onToggle,
  onSeek,
  onSwipe,
  gateSwipe,
}: Props) {
  const [onDeck, next, nextNext] = tracks;
  const lastDir = useRef<SwipeDir>("up");
  const deckRef = useRef<HTMLDivElement | null>(null);
  const deckH = useRef(520);
  const deckW = useRef(360);
  const [locked, setLocked] = useState(false);
  const [fx, setFx] = useState<FX | null>(null);
  const [saveFx, setSaveFx] = useState<SaveFxData | null>(null);
  const [fullSongOpen, setFullSongOpen] = useState(false);
  const fxTimer = useRef<number | undefined>(undefined);
  const saveCount = useRef(0);
  const longPress = useRef<{ timer?: number; fired: boolean }>({ fired: false });

  // ↩ cancels the save animation: the save it depicts was just reverted, and
  // the song is back on deck — letting the disc finish would show it twice
  useEffect(() => {
    if (backToken > 0) setSaveFx(null);
  }, [backToken]);

  useEffect(() => {
    const measure = () => {
      if (deckRef.current) {
        deckH.current = deckRef.current.clientHeight;
        deckW.current = deckRef.current.clientWidth;
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const handleSwipe = (dir: SwipeDir, release?: SaveRelease) => {
    if (locked || !onDeck) return;
    if (gateSwipe && !gateSwipe(dir)) return; // login wall — card snaps back untouched
    lastDir.current = dir;
    setLocked(true);
    if (dir === "down") {
      saveCount.current += 1;
      setSaveFx({
        key: Date.now(),
        track: onDeck,
        from: release ?? { x: 0, y: 0, vx: 0, vy: 650 }, // ♥ button: drop from center
        mode: saveCount.current % 5 === 0 ? "cinematic" : "fast",
      });
    } else if (dir !== "up") {
      const type = dir === "right" ? "more" : "never";
      window.clearTimeout(fxTimer.current);
      setFx({ type, key: Date.now() });
      fxTimer.current = window.setTimeout(() => setFx(null), 700);
    }
    onSwipe(dir);
    window.setTimeout(() => setLocked(false), 200);
  };

  // desktop keyboard support: arrows swipe, space toggles playback
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, SwipeDir> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowRight: "right",
        ArrowLeft: "left",
      };
      if (map[e.key]) {
        e.preventDefault();
        handleSwipe(map[e.key]);
      } else if (e.key === " ") {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const exitCustom: ExitCustom = { dir: lastDir.current, deckH: deckH.current };

  return (
    <div className="deck-wrap">
      <div className="deck" ref={deckRef}>
        {/* keyed by track so an <img> never swaps src in place — swapping
            shows the old picture for a beat while the new one decodes */}
        {nextNext && (
          <div
            key={nextNext.id}
            className="card"
            style={{ transform: "scale(0.88) translateY(26px)", opacity: 0.35 }}
          >
            <img className="card-art" src={nextNext.artwork} alt="" draggable={false} />
            <div className="card-scrim" />
          </div>
        )}
        {next && (
          <div
            key={next.id}
            className="card"
            style={{ transform: "scale(0.94) translateY(14px)", opacity: 0.65 }}
          >
            <img className="card-art" src={next.artwork} alt="" draggable={false} />
            <div className="card-scrim" />
          </div>
        )}
        <AnimatePresence custom={exitCustom}>
          {onDeck && (
            <TopCard
              // backToken in the key: pressing ↩ while the previous card is
              // still exiting would otherwise put two children with the same
              // key inside AnimatePresence ("same key found")
              key={`${onDeck.id}:${backToken}`}
              track={onDeck}
              playing={playing}
              progress={progress}
              exitCustom={exitCustom}
              onSeek={onSeek}
              onSwipe={handleSwipe}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {onDeck && remaining <= 5 && remaining > 0 && !fullSongOpen && (
            <motion.button
              key={`chip-${onDeck.id}`}
              className="fullsong-chip"
              initial={{ opacity: 0, y: 18, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18 }}
              transition={{ type: "spring", stiffness: 420, damping: 26 }}
              onClick={() => setFullSongOpen(true)}
            >
              keep listening ▸
            </motion.button>
          )}
        </AnimatePresence>

        {saveFx && (
          <DiscFX
            key={saveFx.key}
            data={saveFx}
            deckW={deckW.current}
            deckH={deckH.current}
            sticker={saveTarget === "liked" ? "♥" : "✓"}
            onDone={() => setSaveFx(null)}
          />
        )}
        {fx?.type === "more" && (
          <div key={fx.key} className="sparkle-origin">
            <SparkleFX />
          </div>
        )}
        {fx?.type === "never" && <NeverFlashFX key={fx.key} />}
      </div>

      <div className="actions">
        <button
          className="action-btn"
          style={{ color: "var(--never)" }}
          onClick={() => handleSwipe("left")}
          aria-label="Never play this again"
          title="Never (←)"
        >
          <IconX />
        </button>
        <button
          className="action-btn"
          onClick={() => handleSwipe("up")}
          aria-label="Skip"
          title="Skip (↑)"
        >
          <IconSkipUp />
        </button>
        <button
          className="action-btn primary"
          onClick={() => {
            if (longPress.current.fired) {
              longPress.current.fired = false;
              return; // the long-press already opened the sheet
            }
            onToggle();
          }}
          onPointerDown={() => {
            longPress.current.fired = false;
            longPress.current.timer = window.setTimeout(() => {
              longPress.current.fired = true;
              setFullSongOpen(true);
            }, 480);
          }}
          onPointerUp={() => window.clearTimeout(longPress.current.timer)}
          onPointerLeave={() => window.clearTimeout(longPress.current.timer)}
          aria-label={playing ? "Pause (hold for full song)" : "Play (hold for full song)"}
          title="Tap: play/pause · Hold: full song"
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <button
          className="action-btn"
          style={{ color: "var(--save)" }}
          onClick={() => handleSwipe("down")}
          aria-label="Save"
          title="Save (↓)"
        >
          <IconHeart />
        </button>
        <button
          className="action-btn"
          style={{ color: "var(--more)" }}
          onClick={() => handleSwipe("right")}
          aria-label="More like this"
          title="More like this (→)"
        >
          <IconSparkle />
        </button>
      </div>

      <AnimatePresence>
        {fullSongOpen && onDeck && (
          <FullSongSheet track={onDeck} onClose={() => setFullSongOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
