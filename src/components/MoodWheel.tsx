import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { moodAtPush, MOODS, wheelAngle, type MoodId } from "../data/mood";
import type { Verdict } from "../data/predict";
import { Face } from "./faces";

/**
 * The mood ring — six faces orbiting the thumb that summoned them.
 *
 * The first version of this was a big wheel. At 84% of the screen width a
 * wheel that size has nowhere to go but the middle, so wherever you held, it
 * appeared somewhere else and your eye had to travel to find it. That is the
 * one thing a press-and-hold menu must never make you do: the whole point of
 * holding is that your attention is already where your finger is.
 *
 * So the ring is small and it is centred on the fingertip. The faces fly out
 * FROM the finger to their places, which is what tells you where the centre
 * is without drawing anything there — the thumb covers the centre anyway.
 *
 * Designed around the thumb, not just near it:
 *   - The radius clears a fingertip (~90px) without leaving the thumb's reach.
 *   - Whatever sits directly under the thumb is hidden by it, so the name of
 *     the face being aimed at is shown ABOVE the ring, never in the middle.
 *   - Directions are fixed — up is hyped, down-left is tender — so it becomes
 *     muscle memory. Near an edge the ring nudges inward only as far as it has
 *     to; it never rearranges, because a menu that moves its items is a menu
 *     that has to be read every time.
 *   - Release in the middle cancels. Release without aiming leaves the ring up
 *     to be tapped. Arrow keys walk it for anyone without a thumb.
 */

/** ring radius, px — far enough to clear a fingertip */
const RING = 92;
/** each face's circle, px */
const BUBBLE = 54;
/** push less than this and nothing is selected — release cancels */
const DEAD = 38;
/** room kept between the outermost bubble and the frame edge */
const EDGE = 8;

export interface WheelOrigin {
  /** viewport coordinates of the press that opened it */
  x: number;
  y: number;
}

export function MoodWheel({
  origin,
  picked,
  active,
  verdict,
  dragging,
  pointer,
  onCommit,
  onCancel,
  motionPref = "full",
}: {
  origin: WheelOrigin;
  /** what this listener already said about the track under the ring */
  picked: MoodId | null;
  /** the lens currently on the deck */
  active: MoodId | null;
  verdict: Verdict | null;
  /** true while the finger that opened it is still down */
  dragging: boolean;
  /** live pointer position while dragging, else null */
  pointer: { x: number; y: number } | null;
  onCommit: (mood: MoodId) => void;
  onCancel: () => void;
  motionPref?: "full" | "reduced" | "off";
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [keyIndex, setKeyIndex] = useState<number | null>(null);

  /**
   * Every overlay in this app is absolute inside the app's own box (on
   * desktop, a phone-shaped frame in a bigger window), so the ring works in
   * that box's coordinates rather than the viewport's.
   */
  const [host, setHost] = useState<DOMRect | null>(null);
  useEffect(() => {
    const parent = ref.current?.offsetParent as HTMLElement | null;
    setHost((parent ?? document.body).getBoundingClientRect());
  }, []);
  const hostX = host?.left ?? 0;
  const hostY = host?.top ?? 0;
  const hostW = host?.width ?? window.innerWidth;
  const hostH = host?.height ?? window.innerHeight;

  // Centred on the finger, nudged inward only as far as the ring needs.
  const reach = RING + BUBBLE / 2 + EDGE;
  const fx = origin.x - hostX;
  const fy = origin.y - hostY;
  const cx = Math.min(Math.max(fx, reach), hostW - reach);
  const cy = Math.min(Math.max(fy, reach + 40), hostH - reach);

  const aimed = useMemo(() => {
    if (keyIndex !== null) return keyIndex;
    if (!pointer) return null;
    // Measured from where the finger PRESSED, not from where the ring ended
    // up. Near an edge the ring nudges inward, and measuring from its centre
    // meant a thumb that hadn't moved at all was already 60px "off-centre" —
    // aiming at a face it never chose, and committing it on release. The
    // gesture is "push from here"; the direction of the push is the choice.
    const mood = moodAtPush(pointer.x - origin.x, pointer.y - origin.y, DEAD);
    return mood === null ? null : MOODS.findIndex((m) => m.id === mood);
  }, [pointer, keyIndex, origin.x, origin.y]);

  // Release on a face commits it; release in the middle leaves it up.
  const aimedRef = useRef<number | null>(null);
  aimedRef.current = aimed;
  const wasDragging = useRef(dragging);
  useEffect(() => {
    if (wasDragging.current && !dragging && aimedRef.current !== null) {
      onCommit(MOODS[aimedRef.current].id);
    }
    wasDragging.current = dragging;
  }, [dragging, onCommit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
        return;
      }
      const step =
        e.key === "ArrowRight" || e.key === "ArrowDown"
          ? 1
          : e.key === "ArrowLeft" || e.key === "ArrowUp"
            ? -1
            : 0;
      if (step !== 0) {
        e.preventDefault();
        e.stopPropagation();
        setKeyIndex((i) => ((i ?? 0) + step + MOODS.length) % MOODS.length);
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && keyIndex !== null) {
        e.preventDefault();
        e.stopPropagation();
        onCommit(MOODS[keyIndex].id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [keyIndex, onCommit, onCancel]);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const instant = motionPref === "off";
  const lead = aimed !== null ? MOODS[aimed] : null;
  // the label rides above the ring — unless the ring is already at the top of
  // the frame, where it drops below instead of running off it
  const labelBelow = cy - RING - BUBBLE / 2 - 58 < 0;

  return (
    <>
      <motion.div
        className="ring-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: instant ? 0 : 0.14 }}
        onPointerDown={onCancel}
      />

      <div
        ref={ref}
        className="ring"
        tabIndex={-1}
        role="dialog"
        aria-label="Pick a mood"
        style={{ left: cx, top: cy }}
      >
        {/* the orbit itself, faint — it is what makes six faces read as one
            round thing rather than six loose buttons */}
        <motion.span
          className="ring-track"
          style={{ width: RING * 2, height: RING * 2, marginLeft: -RING, marginTop: -RING }}
          initial={{ scale: instant ? 1 : 0.35, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: instant ? 1 : 0.6, opacity: 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 32 }}
        />

        {MOODS.map((m, i) => {
          const a = (wheelAngle(i) * Math.PI) / 180;
          const x = Math.cos(a) * RING;
          const y = Math.sin(a) * RING;
          const on = aimed === i;
          return (
            <motion.button
              key={m.id}
              type="button"
              className={`ring-face${on ? " on" : ""}${picked === m.id ? " picked" : ""}${
                active === m.id ? " lens" : ""
              }`}
              style={{
                width: BUBBLE,
                height: BUBBLE,
                marginLeft: -BUBBLE / 2,
                marginTop: -BUBBLE / 2,
                ["--face" as string]: m.accent,
              }}
              // out of the fingertip and into orbit
              initial={{ x: 0, y: 0, scale: instant ? 1 : 0.3, opacity: 0 }}
              animate={{ x, y, scale: on ? 1.2 : 1, opacity: 1 }}
              exit={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 560,
                damping: 30,
                delay: instant ? 0 : i * 0.022,
              }}
              onPointerEnter={() => setKeyIndex(i)}
              onPointerLeave={() => setKeyIndex(null)}
              onClick={() => onCommit(m.id)}
              aria-label={`${m.label} — ${m.line}`}
              aria-pressed={picked === m.id}
            >
              <Face mood={m.id} size={30} />
            </motion.button>
          );
        })}

        <motion.div
          className={`ring-label${labelBelow ? " below" : ""}`}
          style={{
            top: labelBelow ? RING + BUBBLE / 2 + 14 : -(RING + BUBBLE / 2 + 14),
          }}
          initial={{ opacity: 0, y: labelBelow ? -6 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          // fades with the faces; without an exit it stayed fully drawn over
          // the card until the last face had finished flying home
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ duration: 0.16 }}
          aria-live="polite"
        >
          {lead ? (
            <>
              <b style={{ color: lead.accent }}>{lead.label}</b>
              <span>{lead.line}</span>
            </>
          ) : (
            <span>{dragging ? "push toward a face" : "tap a face"}</span>
          )}
        </motion.div>
      </div>

      <motion.div
        className="ring-hint"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.1 } }}
        transition={{ duration: instant ? 0 : 0.16 }}
      >
        {verdict?.worthShowing ? (
          <span>
            <b>{Math.round(verdict.chance * 100)}%</b> your kind of thing
            {verdict.reasons.length > 0 && ` · ${verdict.reasons.join(", ")}`}
          </span>
        ) : (
          <span>how does this one feel?</span>
        )}
      </motion.div>
    </>
  );
}
