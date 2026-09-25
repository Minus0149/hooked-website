import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MOODS, moodById, type MoodId } from "../data/mood";
import { nameAfterMoodPick } from "../lib/playlistMood";
import { Face } from "./faces";

const SWATCHES = ["#FF3D71", "#7C5CFF", "#00C2FF", "#00E5A0", "#FFB627", "#FF6B35", "#E040FB"];

export interface PlaylistRules {
  allowRepeats?: boolean;
  includeBuried?: boolean;
  includeBlockedArtists?: boolean;
}

export function NewPlaylistSheet({
  onCreate,
  onClose,
}: {
  onCreate: (
    name: string,
    accent: string,
    rules?: PlaylistRules,
    mood?: MoodId | null,
  ) => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [accent, setAccent] = useState(SWATCHES[1]);
  const [rules, setRules] = useState<PlaylistRules>({});
  const [mood, setMood] = useState<MoodId | null>(null);
  const [more, setMore] = useState(false);
  // the name the mood filled in — replaced when the mood changes, but never
  // a name the listener typed themselves
  const autoName = useRef("");

  const pickMood = (next: MoodId | null) => {
    setMood(next);
    const face = next ? moodById(next) : null;
    if (face) setAccent(face.accent);
    const after = nameAfterMoodPick(name, autoName.current, next);
    autoName.current = after.filled;
    setName(after.name);
  };
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // focus without letting the browser scroll the phone frame to "reveal"
  // the input — that scroll is what shifted the whole screen up and stuck
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    // the dialog hook would steal focus back from the input, so just Esc
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    await onCreate(trimmed, accent, rules, mood);
    setBusy(false);
    onClose();
  };

  const activeRules = Object.values(rules).filter(Boolean).length;

  const ruleRow = (
    key: keyof PlaylistRules,
    title: string,
    sub: string,
  ) => (
    <button
      type="button"
      className="settings-row"
      onClick={() => setRules((r) => ({ ...r, [key]: !r[key] }))}
      aria-pressed={!!rules[key]}
    >
      <span className="settings-row-label">
        {title}
        <small>{sub}</small>
      </span>
      <span className={`toggle ${rules[key] ? "on" : ""}`}>
        <span className="toggle-knob" />
      </span>
    </button>
  );

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
        <h3 className="sheet-title">New playlist</h3>
        <p className="sheet-sub">
          {mood
            ? `Swipe down to save here. The deck leans ${moodById(mood)?.label.toLowerCase()} while you fill it.`
            : "Every song you swipe down is saved here until you pick another."}
        </p>

        <p className="settings-group np-label">mood</p>
        <div className="np-moods" role="radiogroup" aria-label="Mood for this playlist">
          <button
            type="button"
            role="radio"
            aria-checked={mood === null}
            className={`np-mood${mood === null ? " on" : ""}`}
            style={{ ["--face" as string]: "var(--text)" }}
            onClick={() => pickMood(null)}
          >
            <span className="np-mood-face np-mood-any">∞</span>
            <small>Any</small>
          </button>
          {MOODS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mood === m.id}
              aria-label={`${m.label} — ${m.line}`}
              className={`np-mood${mood === m.id ? " on" : ""}`}
              style={{ ["--face" as string]: m.accent }}
              onClick={() => pickMood(m.id)}
            >
              <span className="np-mood-face">
                <Face mood={m.id} size={24} animated={mood === m.id} />
              </span>
              <small>{m.label}</small>
            </button>
          ))}
        </div>

        <p className="settings-group np-label">name</p>
        <input
          ref={inputRef}
          className="auth-input"
          placeholder="late night drives, gym, focus…"
          value={name}
          maxLength={40}
          onChange={(e) => {
            autoName.current = "";
            setName(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && void create()}
        />
        <div className="swatches">
          {/* a mood's own colour leads the row, so the picked colour is always one you can see */}
          {(mood && !SWATCHES.includes(moodById(mood)?.accent ?? "")
            ? [moodById(mood)!.accent, ...SWATCHES]
            : SWATCHES
          ).map((c) => (
            <button
              key={c}
              className={`swatch ${accent === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => setAccent(c)}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>

        <button
          type="button"
          className="np-more"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
        >
          {more ? "fewer options" : "more options"}
          {!more && activeRules > 0 && <span className="np-more-count">{activeRules} on</span>}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ transform: more ? "rotate(180deg)" : undefined }}>
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <AnimatePresence initial={false}>
          {more && (
            <motion.div
              className="np-rules"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {ruleRow("allowRepeats", "Allow songs to reappear", "saved songs can come back around")}
              {ruleRow("includeBuried", "Deal buried songs", "songs you swiped left can return")}
              {ruleRow("includeBlockedArtists", "Deal blocked artists", "artists you blocked can return")}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          className="ob-primary"
          style={{ background: accent, color: "#0b0b10" }}
          disabled={!name.trim() || busy}
          onClick={() => void create()}
        >
          {busy ? "…" : mood ? "Create & start discovering" : "Create & start saving here"}
        </button>
      </motion.div>
    </>
  );
}
