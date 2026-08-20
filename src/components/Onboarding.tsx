import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
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
const LAST_STEP = TASTE_STEPS + GESTURE_STEPS.length + 1; // welcome + taste + gestures + done

export function Onboarding({
  demoTracks,
  demoCatalog,
  onFinish,
}: {
  demoTracks: Track[];
  /** the live deck, so the questions only offer what it can serve */
  demoCatalog: Track[];
  onFinish: (taste: TastePrefs) => void;
}) {
  // 0 = welcome, 1-3 = taste, 4-7 = gestures, 8 = done
  const [step, setStep] = useState(0);
  const [taste, setTaste] = useState<TastePrefs>(EMPTY_TASTE);
  const gestureIndex = step - TASTE_STEPS - 1;
  const gs = GESTURE_STEPS[gestureIndex];

  const toggle = (key: "languages" | "genres", id: string) =>
    setTaste((t) => ({
      ...t,
      [key]: t[key].includes(id) ? t[key].filter((x) => x !== id) : [...t[key], id],
    }));

  const finish = () => onFinish(taste);

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
              your next favorite song is <em>one swipe away</em>
            </h1>
            <p className="ob-copy">
              We play you the best part of songs you've never heard. Four swipes
              teach us exactly what you love.
            </p>
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
              what do you listen <em>in?</em>
            </h1>
            <p className="ob-copy">
              Pick as many as you like. This matters more than genre — being fed
              songs in a language you don't speak gets old fast.
            </p>
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
              and what <em>sounds?</em>
            </h1>
            <p className="ob-copy">
              A rough steer, not a filter — everything else still shows up, just
              further down the deck.
            </p>
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
              how far <em>off the map?</em>
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
                <DemoCard
                  key={gs.dir}
                  track={demoTracks[gestureIndex % demoTracks.length]}
                  requiredDir={gs.dir}
                  color={gs.color}
                  onDone={() => setStep((s) => s + 1)}
                />
              </AnimatePresence>
            </div>
            <p className="ob-copy">{gs.copy}</p>
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
              One more thing: the ↩ button up top always brings back the last
              song, in case you swipe too fast.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ob-dots">
        {Array.from({ length: LAST_STEP + 1 }, (_, i) => (
          <span key={i} className={`ob-dot ${i <= step ? "on" : ""}`} />
        ))}
      </div>

      {step === 0 && (
        <button className="ob-primary" onClick={() => setStep(1)}>
          Let's start
        </button>
      )}
      {step >= 1 && step <= TASTE_STEPS && (
        <button className="ob-primary" onClick={() => setStep(step + 1)}>
          {/* never blocked on an answer — an empty one simply tilts nothing */}
          {(step === 1 && taste.languages.length === 0) ||
          (step === 2 && taste.genres.length === 0)
            ? "Skip this"
            : "Next"}
        </button>
      )}
      {step === LAST_STEP && (
        <button className="ob-primary" onClick={finish}>
          Start discovering
        </button>
      )}
      {step > TASTE_STEPS && step < LAST_STEP && (
        <button className="ob-primary" style={{ opacity: 0.25 }} disabled>
          Swipe the card to continue
        </button>
      )}
      {step < LAST_STEP && (
        <button className="ob-skip" onClick={finish}>
          Skip the tour
        </button>
      )}
    </motion.div>
  );
}
