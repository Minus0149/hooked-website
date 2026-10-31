import { motion } from "motion/react";
import { MOODS, type MoodId } from "../data/mood";

/**
 * Shown over the deck after a long run of skips (lib/skipStreak.ts): pick a
 * mood to switch the deck, start the suggestions fresh, or keep going.
 */
export function SkipStreakPrompt({
  streak,
  onMood,
  onFresh,
  onDismiss,
}: {
  streak: number;
  onMood: (mood: MoodId) => void;
  onFresh: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      className="skip-prompt"
      role="dialog"
      aria-label="Not feeling these songs?"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
    >
      <p className="skip-prompt-title">Not feeling these?</p>
      <p className="skip-prompt-sub">{streak} skips in a row. Pick a mood, or start the suggestions fresh.</p>
      <div className="skip-prompt-moods">
        {MOODS.map((m) => (
          <button
            key={m.id}
            type="button"
            className="skip-prompt-mood"
            style={{ borderColor: m.accent, color: m.accent }}
            onClick={() => onMood(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="skip-prompt-actions">
        <button type="button" className="skip-prompt-fresh" onClick={onFresh}>
          Fresh suggestions
        </button>
        <button type="button" className="skip-prompt-dismiss" onClick={onDismiss}>
          Keep going
        </button>
      </div>
    </motion.div>
  );
}
