import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { MOODS, type MoodId } from "../data/mood";
import type { Verdict } from "../data/predict";
import { useDialog } from "../lib/dialog";
import { Face } from "./faces";

/**
 * The faces, on a long press.
 *
 * Two decisions worth defending.
 *
 * It is anchored to the card, not to the finger. A fan that blooms from wherever
 * the thumb happened to land is the more impressive demo and the worse control:
 * the targets move every time, so nothing is ever learned, and near the edge of
 * a phone half of them fall off the screen. Anchored, the sixth face is always
 * in the same place, and the arc is the flourish.
 *
 * It asks about the SONG, not about the listener. "This one feels…" is a
 * question you can answer while looking at a card; "what mood are you in" is
 * not, and conflating them would poison the crowd tags with the listener's
 * evening rather than the record's character. The deck still re-ranks toward
 * the answer — those turn out to be the same gesture — but the question that is
 * actually asked is the one that has a right answer.
 */

export function MoodFan({
  title,
  picked,
  active,
  verdict,
  onPick,
  onClear,
  onClose,
  motionPref = "full",
}: {
  /** the song being labelled, for the header */
  title: string;
  /** what this listener already said about THIS track */
  picked: MoodId | null;
  /** the lens currently on the deck */
  active: MoodId | null;
  /** what the local model makes of this track, when it has earned an opinion */
  verdict: Verdict | null;
  onPick: (mood: MoodId) => void;
  onClear: () => void;
  onClose: () => void;
  motionPref?: "full" | "reduced" | "off";
}) {
  const dialog = useDialog({ onClose });
  const [focused, setFocused] = useState(() =>
    Math.max(0, MOODS.findIndex((m) => m.id === (picked ?? active))),
  );
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // Left/right walk the arc, so the whole thing is reachable without a pointer.
  // Tab still cycles (useDialog), but arrows match how the deck already works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      setFocused((i) => {
        const next = (i + (e.key === "ArrowRight" ? 1 : -1) + MOODS.length) % MOODS.length;
        buttons.current[next]?.focus();
        return next;
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const instant = motionPref === "off";
  const hint = MOODS[focused];

  return (
    <>
      <motion.div
        className="sheet-backdrop mood-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: instant ? 0 : 0.18 }}
        onClick={onClose}
      />
      <motion.div
        className="moodfan"
        initial={{ opacity: 0, y: instant ? 0 : 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: instant ? 0 : 12 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        {...dialog}
        aria-label={`What does ${title} feel like?`}
      >
        <div className="moodfan-head">
          <p className="moodfan-q">This one feels…</p>
          {verdict?.worthShowing && (
            <p className="moodfan-verdict">
              <b>{Math.round(verdict.chance * 100)}%</b> your kind of thing
              {verdict.reasons.length > 0 && (
                <span className="moodfan-why"> · {verdict.reasons.join(", ")}</span>
              )}
            </p>
          )}
        </div>

        <div className="moodfan-arc">
          {MOODS.map((mood, i) => {
            // a hump: the middle faces sit highest, the ends lowest. Pure
            // decoration, and the reason it's an arc rather than a row.
            const lift = Math.round(22 * Math.sin((Math.PI * (i + 0.5)) / MOODS.length));
            const isPicked = picked === mood.id;
            const isActive = active === mood.id;
            return (
              <motion.button
                key={mood.id}
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                type="button"
                className={`moodface${isPicked ? " is-picked" : ""}${isActive ? " is-active" : ""}`}
                style={{ ["--face" as string]: mood.accent }}
                initial={{ opacity: 0, y: instant ? -lift : 16 - lift, scale: instant ? 1 : 0.7 }}
                animate={{ opacity: 1, y: -lift, scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 520,
                  damping: 26,
                  delay: instant ? 0 : i * 0.035,
                }}
                onClick={() => onPick(mood.id)}
                onFocus={() => setFocused(i)}
                onPointerEnter={() => setFocused(i)}
                aria-label={`${mood.label} — ${mood.line}`}
                aria-pressed={isPicked}
                title={mood.line}
              >
                <Face mood={mood.id} size={30} />
                <span className="moodface-label">{mood.label}</span>
              </motion.button>
            );
          })}
        </div>

        <div className="moodfan-foot">
          <span className="moodfan-line">{hint.line}</span>
          {active && (
            <button type="button" className="moodfan-clear" onClick={onClear}>
              Clear mood
            </button>
          )}
        </div>
      </motion.div>
    </>
  );
}
