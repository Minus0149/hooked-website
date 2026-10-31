import { motion } from "motion/react";
import type { Reveal } from "../lib/crowdReveal";

/**
 * Shown for a moment after a save or skip: how everyone else judged the song
 * you just swiped, and your run of calls that matched the crowd.
 */
export function CrowdReveal({ reveal, title, streak }: { reveal: Reveal; title: string; streak: number }) {
  const you = reveal.mine === "save" ? "You saved it" : "You skipped it";
  return (
    <motion.div
      className="crowd"
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: -12, x: "-50%" }}
      animate={{ opacity: 1, y: 0, x: "-50%" }}
      exit={{ opacity: 0, y: -12, x: "-50%" }}
      transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
    >
      <p className="crowd-song">{title}</p>
      {reveal.kind === "first" ? (
        <p className="crowd-line">
          <strong>{you}.</strong> You're one of the first to judge this one.
        </p>
      ) : (
        <>
          <div className="crowd-bar" aria-hidden="true">
            <motion.span
              className="crowd-bar-save"
              initial={{ width: "50%" }}
              animate={{ width: `${reveal.savePct}%` }}
              transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
            />
          </div>
          <p className="crowd-nums">
            <span className={reveal.mine === "save" ? "crowd-mine" : undefined}>{reveal.savePct}% saved</span>
            <span className={reveal.mine === "skip" ? "crowd-mine" : undefined}>{reveal.skipPct}% skipped</span>
          </p>
          <p className="crowd-line">
            <strong>{you}</strong> {reveal.withCrowd ? "— with the crowd" : "— against the crowd"}
            {streak >= 2 ? <span className="crowd-streak"> · {streak} in a row</span> : null}
          </p>
        </>
      )}
    </motion.div>
  );
}
