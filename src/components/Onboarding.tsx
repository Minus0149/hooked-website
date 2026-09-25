import { TOUR_COPY, tasteStepButton } from "../lib/tourCopy";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";
import type { SwipeDir, Track } from "../types";
import {
  ADVENTURE,
  EMPTY_TASTE,
  availableTasteOptions,
  type Adventure,
  type TastePrefs,
} from "../data/taste";
import { resolveDir } from "./SwipeDeck";
import { IconArrow } from "./icons";
import { MoodWheel, type WheelOrigin } from "./MoodWheel";
import { moodById, type MoodId } from "../data/mood";

interface GestureStep {
  dir: SwipeDir;
  headline: ReactNode;
  copy: string;
  color: string;
  arrowRotate: number;
  arrowPos: CSSProperties;
}

const GESTURE_STEPS: GestureStep[] = [
  {
    dir: "up",
    headline: (
      <>
        not feeling it? <em>swipe up</em>
      </>
    ),
    copy: "Skips to the next song instantly. No hard feelings — we learn from it anyway.",
    color: "#ffffff",
    arrowRotate: 0,
    arrowPos: { top: -52, left: "50%", translate: "-50% 0" },
  },
  {
    dir: "down",
    headline: (
      <>
        love it? <em>swipe down</em>
      </>
    ),
    copy: "Saves it to your Liked Songs or a playlist — you choose where in settings.",
    color: "var(--save)",
    arrowRotate: 180,
    arrowPos: { bottom: -52, left: "50%", translate: "-50% 0" },
  },
  {
    dir: "right",
    headline: (
      <>
        want more like it? <em>swipe right</em>
      </>
    ),
    copy: "Doesn't save it — just tells the algorithm to chase this exact vibe.",
    color: "var(--more)",
    arrowRotate: 90,
    arrowPos: { right: -52, top: "50%", translate: "0 -50%" },
  },
  {
    dir: "left",
    headline: (
      <>
        hate it? <em>swipe left</em>
      </>
    ),
    copy: "Never plays it again, and steers your feed far away from it.",
    color: "var(--never)",
    arrowRotate: -90,
    arrowPos: { left: -52, top: "50%", translate: "0 -50%" },
  },
];

/**
 * The fifth gesture, which nothing else teaches.
 *
 * Swipes announce themselves: the card moves under your thumb the moment you
 * touch it. A long press announces nothing — you either know it is there or
 * you never find it, and a feature nobody finds may as well not have shipped.
 * So it gets a step of its own, and the step asks for something useful while
 * it teaches: the first mood, which the opening deck is then built around.
 */
function HoldCard({
  track,
  onHeld,
  holding,
}: {
  track: Track;
  onHeld: (x: number, y: number) => void;
  holding: boolean;
}) {
  const hold = useRef<{ timer?: number; x: number; y: number }>({ x: 0, y: 0 });
  const [pressing, setPressing] = useState(false);
  const cancel = () => {
    window.clearTimeout(hold.current.timer);
    hold.current.timer = undefined;
    setPressing(false);
  };
  useEffect(() => cancel, []);

  return (
    <motion.div
      className="card is-top"
      animate={pressing ? { scale: 0.97 } : { scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      onPointerDown={(e) => {
        hold.current.x = e.clientX;
        hold.current.y = e.clientY;
        setPressing(true);
        window.clearTimeout(hold.current.timer);
        const { clientX, clientY } = e;
        hold.current.timer = window.setTimeout(() => {
          hold.current.timer = undefined;
          setPressing(false);
          onHeld(clientX, clientY);
        }, 420);
      }}
      onPointerMove={(e) => {
        // once the wheel is up the window listener owns the finger
        if (holding) return;
        if (hold.current.timer === undefined) return;
        const moved =
          Math.abs(e.clientX - hold.current.x) + Math.abs(e.clientY - hold.current.y);
        if (moved > 10) cancel();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
      <img className="card-art" src={track.artwork} alt="" draggable={false} />
      <div className="card-scrim" />
      <div className="card-meta" style={{ left: 14, right: 14, bottom: 12 }}>
        <span className="card-genre">{track.genre}</span>
        <h2 className="card-title" style={{ fontSize: 15 }}>{track.title}</h2>
      </div>
      <motion.span
        className="ob-hold-ring"
        initial={false}
        animate={pressing ? { scale: 1, opacity: 1 } : { scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.42, ease: "linear" }}
      />
    </motion.div>
  );
}

function DemoCard({
  track,
  requiredDir,
  color,
  onDone,
}: {
  track: Track;
  requiredDir: SwipeDir;
  color: string;
  onDone: () => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-160, 160], [-12, 12]);
  const [wrong, setWrong] = useState(0);

  return (
    <motion.div
      className="card is-top"
      style={{ x, y, rotate, position: "absolute", inset: 0 }}
      drag
      dragSnapToOrigin
      dragElastic={0.7}
      onDragEnd={(_, info) => {
        const dir = resolveDir(info);
        if (dir === requiredDir) onDone();
        else if (dir) setWrong((w) => w + 1);
      }}
      key={`demo-${requiredDir}-${wrong}`}
      initial={{ scale: 0.92, opacity: 0 }}
      animate={
        wrong
          ? { scale: 1, opacity: 1, x: [0, -8, 8, -5, 5, 0] }
          : { scale: 1, opacity: 1 }
      }
      exit={{ scale: 0.85, opacity: 0, transition: { duration: 0.2 } }}
    >
      <img className="card-art" src={track.artwork} alt="" draggable={false} />
      <div className="card-scrim" />
      <div className="card-meta" style={{ left: 14, right: 14, bottom: 12 }}>
        <h2 className="card-title" style={{ fontSize: 15 }}>{track.title}</h2>
        <p className="card-artist" style={{ fontSize: 12 }}>{track.artist}</p>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 28,
          border: `2.5px dashed ${color}`,
          opacity: 0.7,
          pointerEvents: "none",
        }}
      />
    </motion.div>
  );
}

/**
 * Three questions, then the gesture tour.
 *
 * The questions come first because a cold deck is the worst version of this
 * app — swipe-to-learn needs a dozen swipes before it knows anything, and most
 * people leave before that. Every one is skippable: an empty answer tilts
 * nothing and the deck behaves exactly as it did before.
 */
const TASTE_STEPS = 3;
/** welcome + taste + the four swipes + the hold */
const HOLD_STEP = TASTE_STEPS + GESTURE_STEPS.length + 1;
const LAST_STEP = HOLD_STEP + 1; // ...and done

export function Onboarding({
  demoTracks,
  demoCatalog,
  onFinish,
}: {
  demoTracks: Track[];
  /** the live deck, so the questions only offer what it can serve */
  demoCatalog: Track[];
  onFinish: (taste: TastePrefs, mood: MoodId | null) => void;
}) {
  // 0 = welcome, 1-3 = taste, 4-7 = the four swipes, 8 = the hold, 9 = done
  const [step, setStep] = useState(0);
  const [taste, setTaste] = useState<TastePrefs>(EMPTY_TASTE);
  const [mood, setMood] = useState<MoodId | null>(null);
  const [wheel, setWheel] = useState<WheelOrigin | null>(null);
  const [holding, setHolding] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const closeWheel = () => {
    setWheel(null);
    setHolding(false);
    setPointer(null);
  };

  // same as the deck: the backdrop covers the card the moment the wheel opens,
  // so the aiming finger is tracked on the window
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
  const gestureIndex = step - TASTE_STEPS - 1;
  const gs = step < HOLD_STEP ? GESTURE_STEPS[gestureIndex] : undefined;

  const toggle = (key: "languages" | "genres", id: string) =>
    setTaste((t) => ({
      ...t,
      [key]: t[key].includes(id) ? t[key].filter((x) => x !== id) : [...t[key], id],
    }));

  const finish = () => onFinish(taste, mood);

  // only offer what today's catalogue can actually play
  const options = useMemo(() => availableTasteOptions(demoCatalog), [demoCatalog]);

  return (
    <motion.div
      className="onboarding"
      exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.35 } }}
    >
      <div className="ob-logo">
        hooked<span style={{ color: "var(--accent)" }}>.</span>
      </div>

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div
            key="welcome"
            className="ob-step-wrap"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
          >
            <h1 className="ob-headline">
              {TOUR_COPY.welcome.headline.lead} <em>{TOUR_COPY.welcome.headline.accent}</em>
            </h1>
            <p className="ob-copy">{TOUR_COPY.welcome.copy}</p>
            <span className="eq" style={{ height: 22 }}>
              <span /><span /><span /><span />
            </span>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div
            key="lang"
            className="ob-step-wrap"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
          >
            <h1 className="ob-headline">
              {TOUR_COPY.languages.headline.lead} <em>{TOUR_COPY.languages.headline.accent}</em>
            </h1>
            <p className="ob-copy">{TOUR_COPY.languages.copy}</p>
            <div className="ob-chips">
              {options.languages.map((l) => (
                <button
                  key={l.id}
                  className={`ob-chip ${taste.languages.includes(l.id) ? "on" : ""}`}
                  onClick={() => toggle("languages", l.id)}
                  aria-pressed={taste.languages.includes(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="genre"
            className="ob-step-wrap"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
          >
            <h1 className="ob-headline">
              {TOUR_COPY.genres.headline.lead} <em>{TOUR_COPY.genres.headline.accent}</em>
            </h1>
            <p className="ob-copy">{TOUR_COPY.genres.copy}</p>
            <div className="ob-chips">
              {options.genres.map((g) => (
                <button
                  key={g.id}
                  className={`ob-chip ${taste.genres.includes(g.id) ? "on" : ""}`}
                  onClick={() => toggle("genres", g.id)}
                  aria-pressed={taste.genres.includes(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div
            key="adventure"
            className="ob-step-wrap"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
          >
            <h1 className="ob-headline">
              {TOUR_COPY.adventure.headline.lead} <em>{TOUR_COPY.adventure.headline.accent}</em>
            </h1>
            <div className="ob-choices">
              {ADVENTURE.map((a) => (
                <button
                  key={a.id}
                  className={`ob-choice ${taste.adventure === a.id ? "on" : ""}`}
                  onClick={() => setTaste((t) => ({ ...t, adventure: a.id as Adventure }))}
                  aria-pressed={taste.adventure === a.id}
                >
                  <strong>{a.label}</strong>
                  <small>{a.copy}</small>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {gs && (
          <motion.div
            key={gs.dir}
            className="ob-step-wrap"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
          >
            <h1 className="ob-headline" style={{ fontSize: 22 }}>
              {gs.headline}
            </h1>
            <div className="ob-demo">
              <motion.div
                className="ob-arrow"
                style={gs.arrowPos}
                animate={{ opacity: [0.35, 1, 0.35] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              >
                <span style={{ color: gs.color, display: "grid" }}>
                  <IconArrow rotate={gs.arrowRotate} />
                </span>
              </motion.div>
              <AnimatePresence>
                {/* a catalogue thin enough to leave the demo deck empty must
                    degrade to "no card", never crash on `undefined.artwork` */}
                {demoTracks.length > 0 && (
                  <DemoCard
                    key={gs.dir}
                    track={demoTracks[gestureIndex % demoTracks.length]}
                    requiredDir={gs.dir}
                    color={gs.color}
                    onDone={() => setStep((s) => s + 1)}
                  />
                )}
              </AnimatePresence>
            </div>
            <p className="ob-copy">{gs.copy}</p>
          </motion.div>
        )}

        {step === HOLD_STEP && (
          <motion.div
            key="hold"
            className="ob-step-wrap"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
          >
            <h1 className="ob-headline" style={{ fontSize: 22 }}>
              and <em>hold</em>, then push
            </h1>
            <div className="ob-demo ob-demo-hold">
              {demoTracks.length > 0 && (
                <HoldCard
                  track={demoTracks[0]}
                  holding={wheel !== null && holding}
                  onHeld={(x, y) => {
                    setWheel({ x, y });
                    setHolding(true);
                    setPointer({ x, y });
                  }}
                />
              )}
              {!wheel && !mood && (
                <motion.span
                  className="ob-hold-hint"
                  animate={{ opacity: [0.35, 1, 0.35] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                >
                  press and hold
                </motion.span>
              )}
            </div>
            <p className="ob-copy">
              {mood
                ? `Nice — we'll open with ${moodById(mood)?.label.toLowerCase()}. Hold any card to change it, any time.`
                : TOUR_COPY.hold.copy}
            </p>
          </motion.div>
        )}

        {step === LAST_STEP && (
          <motion.div
            key="done"
            className="ob-step-wrap"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <h1 className="ob-headline">
              you're <em>ready.</em>
            </h1>
            <p className="ob-copy">
              Four swipes and a hold. The ↩ button up top always brings back
              the last song, in case you go too fast.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {wheel && step === HOLD_STEP && demoTracks.length > 0 && (
          <MoodWheel
            origin={wheel}
            picked={mood}
            active={mood}
            verdict={null}
            dragging={holding}
            // the LAST position survives the release: nulling it on lift reset the
            // aim in the same render the commit reads it, so only pushes that
            // happened to end on a bubble ever landed
            pointer={pointer}
            onCommit={(m) => {
              setMood(m);
              closeWheel();
            }}
            onCancel={closeWheel}
          />
        )}
      </AnimatePresence>

      <div className="ob-dots">
        {Array.from({ length: LAST_STEP + 1 }, (_, i) => (
          <span key={i} className={`ob-dot ${i <= step ? "on" : ""}`} />
        ))}
      </div>

      {step === 0 && (
        <button className="ob-primary" onClick={() => setStep(1)}>
          {TOUR_COPY.start}
        </button>
      )}
      {step >= 1 && step <= TASTE_STEPS && (
        <button className="ob-primary" onClick={() => setStep(step + 1)}>
          {/* never blocked on an answer — an empty one simply tilts nothing */}
          {tasteStepButton(step, taste)}
        </button>
      )}
      {step === LAST_STEP && (
        <button className="ob-primary" onClick={finish}>
          Start discovering
        </button>
      )}
      {step > TASTE_STEPS && step < HOLD_STEP && (
        <button className="ob-primary" style={{ opacity: 0.25 }} disabled>
          Swipe the card to continue
        </button>
      )}
      {step === HOLD_STEP && (
        <button
          className="ob-primary"
          style={mood ? undefined : { opacity: 0.25 }}
          onClick={() => setStep(LAST_STEP)}
          disabled={!mood}
        >
          {mood ? "Next" : "Hold the card to continue"}
        </button>
      )}
      {step < LAST_STEP && (
        <button className="ob-skip" onClick={finish}>
          {TOUR_COPY.skip}
        </button>
      )}
    </motion.div>
  );
}
