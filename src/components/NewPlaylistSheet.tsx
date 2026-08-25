import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

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
  onCreate: (name: string, accent: string, rules?: PlaylistRules) => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [accent, setAccent] = useState(SWATCHES[1]);
  const [rules, setRules] = useState<PlaylistRules>({});
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
    await onCreate(trimmed, accent, rules);
    setBusy(false);
    onClose();
  };

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
          Every song you swipe down will be saved here until you change it in
          settings.
        </p>
        <input
          ref={inputRef}
          className="auth-input"
          placeholder="late night drives, gym, focus…"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
        />
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button
              key={c}
              className={`swatch ${accent === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => setAccent(c)}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>

        <p className="settings-group" style={{ margin: "6px 0 8px" }}>
          discovery rules
        </p>
        {ruleRow("allowRepeats", "Allow songs to reappear", "saved songs can come back around")}
        {ruleRow("includeBuried", "Deal buried songs", "songs you swiped left can return")}
        {ruleRow("includeBlockedArtists", "Deal blocked artists", "artists you blocked can return")}

        <button
          className="ob-primary"
          style={{ background: accent, color: "#0b0b10" }}
          disabled={!name.trim() || busy}
          onClick={() => void create()}
        >
          {busy ? "…" : "Create & start saving here"}
        </button>
      </motion.div>
    </>
  );
}
