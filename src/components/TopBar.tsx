import type { Track } from "../types";
import { art } from "../lib/art";
import { IconBack, IconFolder, IconHeart } from "./icons";

interface Props {
  previous: Track | null;
  onBack: () => void;
  saveTarget: string; // "liked" | "discoveries" | "pl:<id>"
  onOpenSettings: () => void;
}

export function TopBar({ previous, onBack, saveTarget, onOpenSettings }: Props) {
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

      <span className="wordmark">
        hooked<span className="dot">.</span>
      </span>

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
