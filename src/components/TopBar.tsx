import type { Track } from "../types";
import { art } from "../lib/art";
import { moodById, type MoodId } from "../data/mood";
import { IconBack, IconFolder, IconHeart } from "./icons";
import { Face } from "./faces";

interface Props {
  previous: Track | null;
  onBack: () => void;
  saveTarget: string; // "liked" | "discoveries" | "pl:<id>"
  onOpenSettings: () => void;
  /** the lens on the deck, shown where the wordmark usually is */
  mood: MoodId | null;
  onClearMood: () => void;
}

/**
 * While a mood is on, the pill stands where the name does.
 *
 * A fourth control in a three-slot bar would crowd it, and a lens that is on
 * without being visible is the kind of state that gets blamed on the algorithm
 * — "why is it only playing sad songs" has to have an answer on screen. The
 * name comes back the moment it's cleared, which is one tap on the same pill.
 */
export function TopBar({
  previous,
  onBack,
  saveTarget,
  onOpenSettings,
  mood,
  onClearMood,
}: Props) {
  const lens = moodById(mood);
  return (
    <header className="topbar">
      <button
        className="topbar-btn"
        onClick={onBack}
        disabled={!previous}
        aria-label={previous ? `Back to ${previous.title}` : "No previous song"}
        title={previous ? `Back to ${previous.title}` : "No previous song"}
      >
        {previous && <img src={art(previous.artwork, 100)} alt="" />}
        <IconBack />
      </button>

      {lens ? (
        <button
          type="button"
          className="mood-pill"
          style={{ ["--face" as string]: lens.accent }}
          onClick={onClearMood}
          aria-label={`${lens.label} mood is on — tap to clear`}
          title={`${lens.line} · tap to clear`}
        >
          <Face mood={lens.id} size={17} strokeWidth={1.9} />
          {lens.label}
          <span className="mood-pill-x" aria-hidden="true">✕</span>
        </button>
      ) : (
        <span className="wordmark">
          hookedcue<span className="dot">.</span>
        </span>
      )}

      <button
        className="topbar-btn"
        onClick={onOpenSettings}
        aria-label="Where swipes get saved"
        title="Where swipes get saved"
        style={{ color: saveTarget === "liked" ? "var(--save)" : "var(--more)" }}
      >
        {saveTarget === "liked" ? <IconHeart size={18} /> : <IconFolder size={18} />}
      </button>
    </header>
  );
}
