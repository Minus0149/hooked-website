import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ReportSong } from "./ReportSong";
import { REPORT_COPY } from "../lib/contentReport";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "motion/react";
import type { SwipeDir, Track } from "../types";
import type { MoodId } from "../data/mood";
import type { Verdict } from "../data/predict";
import { MoodWheel, type WheelOrigin } from "./MoodWheel";
import { gesture } from "../design/tokens";
import { useDialog } from "../lib/dialog";
import { appleMusicUrl, ITUNES_CREDIT, needsItunesCredit } from "../lib/attribution";
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
  hookIndex: number;
  hookCount: number;
  hookLabel?: string;
  onNextHook: () => void;
  // return false to refuse the swipe (login gate) — card snaps back, no FX
  gateSwipe?: (dir: SwipeDir) => boolean;
  // scales the drag distance a swipe needs (Settings → Gestures)
  sensitivity?: number;
  // gates the save vinyl: off skips it, reduced downgrades cinematic→fast
  motionPref?: "full" | "reduced" | "off";
  /** the lens currently on the deck */
  activeMood: MoodId | null;
  /** what this listener already said the song on deck feels like */
  pickedMood: MoodId | null;
  /** the local model's read on the song on deck, or null before it has one */
  verdict: Verdict | null;
  onPickMood: (mood: MoodId, trackId: string) => void;
  onClearMood: () => void;
}

export function resolveDir(info: PanInfo, sensitivity = 1): SwipeDir | null {
  const { offset, velocity } = info;
  const absX = Math.abs(offset.x);
  const absY = Math.abs(offset.y);
  // sensitivity scales the drag distance a swipe needs (mobile parity); the
  // flick threshold stays fixed so a decisive flick always commits
  const committedByDistance =
    Math.max(absX, absY) > gesture.commitDistance * sensitivity;
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
  deckW: number;
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
    // fly past the MEASURED deck edge (plus margin) instead of a hardcoded
    // pixel count — tall screens used to watch the card die mid-screen
    const base = EXIT[dir];
    const far =
      dir === "up"
        ? -(custom?.deckH ?? 760) * 1.2
        : (dir === "right" ? 1 : -1) *
          Math.max(custom?.deckW ?? 520, 360) * 1.3;
    return {
      x: dir === "left" || dir === "right" ? far : base.x,
      y: dir === "up" ? far : base.y,
      rotate: base.rotate,
      scale: base.scale,
      opacity: 0,
      transition: { duration: 0.32, ease: "easeOut" as const },
    };
  },
};

/* ---------- swipe FX overlays ---------- */

type FX = { type: "more" | "never"; key: number };

/**
 * Segmented progress, one bar per hook — the Stories convention, because
 * everyone already knows what it means.
 *
 * Deliberately not swipeable: up/down/left/right are all spoken for, so moving
 * between hooks is time (auto-advance) and tap, never a gesture.
 */
function HookDots({
  count,
  index,
  progress,
}: {
  count: number;
  index: number;
  progress: number;
}) {
  if (count <= 1) return null;
  return (
    <div className="hookdots" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span className="hookdot" key={i}>
          <span
            className="hookdot-fill"
            style={{ transform: `scaleX(${i < index ? 1 : i === index ? progress : 0})` }}
          />
        </span>
      ))}
    </div>
  );
}

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
      style={{ "--p": Math.min(Math.max(progress, 0), 1) } as CSSProperties}
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
      {/* scaleX + a CSS var instead of width/left: transform never triggers
          layout, so a 4Hz progress tick can't thrash the whole card */}
      <div className="scrub-fill" />
      <div className="scrub-knob" />
    </div>
  );
}

/** Links out to where the track can legally play in full. */
function FullSongSheet({ track, onClose }: { track: Track; onClose: () => void }) {
  const dialog = useDialog({ onClose });
  // "Report this song" turns this sheet into the report form (Play's UGC policy)
  const [reporting, setReporting] = useState(false);
  // Drawn into the app's frame (.phone), like the mood wheel: inside the deck
  // it was positioned against the Discover screen, which on a short window is
  // scrolled up inside the frame — the report form's title sat off the top.
  const host = typeof document === "undefined" ? null : (document.querySelector(".phone") as HTMLElement | null);
  const q = encodeURIComponent(`${track.title} ${track.artist}`);
  // the song itself on Apple Music when the preview is Apple's (lib/attribution)
  const services = [
    { name: "Apple Music", href: appleMusicUrl(track) },
    { name: "Spotify", href: `https://open.spotify.com/search/${q}` },
    { name: "YouTube", href: `https://www.youtube.com/results?search_query=${q}` },
  ];
  return createPortal(
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
        {...dialog}
      >
        {reporting ? (
          <ReportSong track={track} onBack={() => setReporting(false)} onDone={onClose} />
        ) : (
        <>
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
        {needsItunesCredit(track) && <p className="sheet-credit">preview {ITUNES_CREDIT}</p>}
        <button type="button" className="sheet-report" onClick={() => setReporting(true)}>
          {REPORT_COPY.link}
        </button>
        </>
        )}
      </motion.div>
    </>,
    host ?? document.body,
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
  hookIndex,
  hookCount,
  hookLabel,
  onNextHook,
  exitCustom,
  onSeek,
  onSwipe,
  sensitivity = 1,
  onLongPress,
  holding,
  verdict,
}: {
  track: Track;
  playing: boolean;
  progress: number;
  hookIndex: number;
  hookCount: number;
  hookLabel?: string;
  onNextHook: () => void;
  exitCustom: ExitCustom;
  onSeek: (fraction: number) => void;
  onSwipe: (dir: SwipeDir, release?: SaveRelease) => void;
  /** scales the drag distance a swipe needs (Settings → Gestures) */
  sensitivity?: number;
  onLongPress: (x: number, y: number) => void;
  /** true once the wheel is up — the card must stop being draggable */
  holding: boolean;
  verdict: Verdict | null;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-13, 13]);

  /**
   * Hold the card to open the faces.
   *
   * The card is also the drag surface, so the two have to be told apart, and
   * the honest difference is movement: a swipe moves, a hold doesn't. Ten
   * pixels of slack covers the wobble in a real thumb without letting a slow
   * drag turn into a mood pick. Cancelled on release, on leaving, and on the
   * browser stealing the pointer for a scroll.
   */
  const hold = useRef<{ timer?: number; x: number; y: number }>({ x: 0, y: 0 });
  const cancelHold = useCallback(() => {
    window.clearTimeout(hold.current.timer);
    hold.current.timer = undefined;
  }, []);

  useEffect(() => cancelHold, [cancelHold]);

  const upOpacity = useTransform(y, [-110, -36], [1, 0]);
  const downOpacity = useTransform(y, [36, 110], [0, 1]);
  const rightOpacity = useTransform(x, [36, 110], [0, 1]);
  const leftOpacity = useTransform(x, [-110, -36], [1, 0]);

  return (
    <motion.div
      className="card is-top"
      style={{ x, y, rotate }}
      drag={!holding}
      dragSnapToOrigin
      dragElastic={0.7}
      whileDrag={holding ? undefined : { scale: 1.02 }}
      onPointerDown={(e) => {
        hold.current.x = e.clientX;
        hold.current.y = e.clientY;
        const { clientX, clientY } = e;
        window.clearTimeout(hold.current.timer);
        hold.current.timer = window.setTimeout(() => {
          hold.current.timer = undefined;
          onLongPress(clientX, clientY);
        }, 420);
      }}
      onPointerMove={(e) => {
        // once the wheel is up the window listener owns the finger
        if (holding) return;
        if (hold.current.timer === undefined) return;
        const moved =
          Math.abs(e.clientX - hold.current.x) + Math.abs(e.clientY - hold.current.y);
        if (moved > 10) cancelHold();
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      // a long-press on the artwork would otherwise open the browser's image
      // menu on Android, on top of the mood ring
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={cancelHold}
      onDragEnd={(_, info) => {
        const dir = resolveDir(info, sensitivity);
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
      <HookDots count={hookCount} index={hookIndex} progress={progress} />
      {hookCount > 1 && (
        <button
          type="button"
          className="hooktap"
          onClick={onNextHook}
          aria-label={`next hook (${hookIndex + 1} of ${hookCount})`}
        >
          {hookLabel && <span className="hooktap-label">{hookLabel}</span>}
        </button>
      )}

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
        <span className="card-genre">
          {track.genre}
          {verdict?.worthShowing && verdict.chance >= 0.7 && (
            // Only when the model has both earned an opinion and formed a
            // strong one. A badge on every card would be wallpaper, and a
            // badge on a coin-flip would be a lie.
            <span className="card-match" title={
              verdict.reasons.length > 0
                ? `because: ${verdict.reasons.join(", ")}`
                : "based on what you've kept"
            }>
              {Math.round(verdict.chance * 100)}% you
            </span>
          )}
        </span>
        <h2 className="card-title">{track.title}</h2>
        <p className="card-artist">
          <span className={`eq ${playing ? "" : "paused"}`}>
            <span /><span /><span /><span />
          </span>
          {track.artist}
        </p>
        {/* Apple's condition for playing its previews (lib/attribution.ts) */}
        {needsItunesCredit(track) && <p className="card-credit">{ITUNES_CREDIT}</p>}
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
  hookIndex,
  hookCount,
  hookLabel,
  onNextHook,
  gateSwipe,
  sensitivity = 1,
  motionPref = "full",
  activeMood,
  pickedMood,
  verdict,
  onPickMood,
  onClearMood,
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
  /** the emote wheel: where it opened, whether the finger is still down, and
      where that finger is now */
  const [wheel, setWheel] = useState<WheelOrigin | null>(null);
  const [holding, setHolding] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const closeWheel = useCallback(() => {
    setWheel(null);
    setHolding(false);
    setPointer(null);
  }, []);
  const fxTimer = useRef<number | undefined>(undefined);
  const saveCount = useRef(0);
  const longPress = useRef<{ timer?: number; fired: boolean }>({ fired: false });

  // ↩ cancels the save animation: the save it depicts was just reverted, and
  // the song is back on deck — letting the disc finish would show it twice
  useEffect(() => {
    if (backToken > 0) setSaveFx(null);
  }, [backToken]);

  // The fan labels one specific song. If the card moves on — a swipe, a revert,
  // an auto-advance — the question it is asking is about a card nobody is
  // looking at any more, so it closes rather than quietly retargeting.
  useEffect(() => closeWheel(), [onDeck?.id, closeWheel]);

  /**
   * While the wheel is open and the finger is still down, the pointer is
   * tracked on the window rather than on the card. The backdrop sits over the
   * card the instant the wheel appears, so card-level pointermove stops firing
   * exactly when the aiming starts — which is the whole gesture.
   */
  useEffect(() => {
    if (!wheel || !holding) return;
    const move = (e: PointerEvent) => setPointer({ x: e.clientX, y: e.clientY });
    const end = () => setHolding(false);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
    };
  }, [wheel, holding]);

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

  const handleSwipe = useCallback(
    (dir: SwipeDir, release?: SaveRelease) => {
      if (locked || !onDeck) return;
      // Belt and braces: `drag` is switched off the moment the wheel opens,
      // but motion can already be mid-gesture when that happens, and a drag
      // that survives turns "aim at tender" into "never play this artist".
      // The wheel being open is an unconditional veto on a swipe.
      if (wheel) return;
      if (gateSwipe && !gateSwipe(dir)) return; // login wall — card snaps back untouched
      lastDir.current = dir;
      setLocked(true);
      if (dir === "down") {
        saveCount.current += 1;
        // motion pref gates the vinyl: "off" skips it entirely, "reduced"
        // always takes the punchy cut, "full" earns the cinematic one in five
        if (motionPref !== "off") {
          setSaveFx({
            key: Date.now(),
            track: onDeck,
            from: release ?? { x: 0, y: 0, vx: 0, vy: 650 }, // ♥ button: drop from center
            mode:
              motionPref === "reduced" || saveCount.current % 5 !== 0
                ? "fast"
                : "cinematic",
          });
        }
      } else if (dir !== "up") {
        const type = dir === "right" ? "more" : "never";
        window.clearTimeout(fxTimer.current);
        setFx({ type, key: Date.now() });
        fxTimer.current = window.setTimeout(() => setFx(null), 700);
      }
      onSwipe(dir);
      window.setTimeout(() => setLocked(false), 200);
    },
    [locked, onDeck, gateSwipe, onSwipe, motionPref, wheel],
  );

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
      } else if (e.key === "m" || e.key === "M") {
        // the long press, for anyone without one — the wheel opens centred
        e.preventDefault();
        setWheel((w) =>
          w ? null : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
        );
        setHolding(false);
        setPointer(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSwipe, onToggle]);

  const exitCustom: ExitCustom = {
    dir: lastDir.current,
    deckH: deckH.current,
    deckW: deckW.current,
  };

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
              hookIndex={hookIndex}
              hookCount={hookCount}
              hookLabel={hookLabel}
              onNextHook={onNextHook}
              exitCustom={exitCustom}
              onSeek={onSeek}
              onSwipe={handleSwipe}
              sensitivity={sensitivity}
              onLongPress={(x, y) => {
                setWheel({ x, y });
                setHolding(true);
                setPointer({ x, y });
              }}
              holding={wheel !== null && holding}
              verdict={verdict}
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

      <AnimatePresence>
        {wheel && onDeck && (
          <MoodWheel
            origin={wheel}
            picked={pickedMood}
            active={activeMood}
            verdict={verdict}
            dragging={holding}
            // the LAST position survives the release: nulling it on lift reset the
            // aim in the same render the commit reads it, so only pushes that
            // happened to end on a bubble ever landed
            pointer={pointer}
            motionPref={motionPref}
            onCommit={(mood) => {
              onPickMood(mood, onDeck.id);
              closeWheel();
            }}
            onCancel={closeWheel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
