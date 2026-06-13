import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

const SWATCHES = ["#FF3D71", "#7C5CFF", "#00C2FF", "#00E5A0", "#FFB627", "#FF6B35", "#E040FB"];

export function NewPlaylistSheet({
  onCreate,
  onClose,
}: {
  onCreate: (name: string, accent: string) => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [accent, setAccent] = useState(SWATCHES[1]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // focus without letting the browser scroll the phone frame to "reveal"
  // the input — that scroll is what shifted the whole screen up and stuck
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    await onCreate(trimmed, accent);
    setBusy(false);
    onClose();
  };

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
