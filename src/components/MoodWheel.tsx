import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { moodAtPush, MOODS, wheelAngle, type MoodId } from "../data/mood";
import type { Verdict } from "../data/predict";
import { Face } from "./faces";
import { faceIdle } from "./faceMotion";

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
/** height of the hint strip at the bottom, which the ring must not cover */
const HINT_ROOM = 44;

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
  hint,
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
  /** the line under everything; defaults to the card's "how does this one feel?" */
  hint?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [keyIndex, setKeyIndex] = useState<number | null>(null);

  /**
   * The ring draws into the app's own box — the `.phone` frame, which on
   * desktop is a phone-shaped box in a bigger window — through a portal, and
   * measures that same box.
   *
   * It used to render wherever its owner sat and measure its offsetParent.
   * Inside the deck that owner is a transformed container, which becomes the
   * containing block for absolute children but is NOT their offsetParent: on
   * desktop the two differed by 119px, so the ring opened left of the finger,
   * the backdrop covered only part of the phone and the hint sat in a corner.
   * One element for both drawing and measuring makes that impossible.
   */
  const frame = useMemo(
    () => (document.querySelector(".phone") as HTMLElement | null) ?? document.body,
    [],
  );
  const [host] = useState<DOMRect>(() => frame.getBoundingClientRect());
  // the frame's border is outside the box its absolute children lay out in
  const hostX = host.left + frame.clientLeft;
  const hostY = host.top + frame.clientTop;
  const hostW = frame.clientWidth || host.width;
  const hostH = frame.clientHeight || host.height;

  // Centred on the finger, nudged inward only as far as the ring needs.
  const reach = RING + BUBBLE / 2 + EDGE;
  const fx = origin.x - hostX;
  const fy = origin.y - hostY;
  const cx = Math.min(Math.max(fx, reach), hostW - reach);
  // the hint strip along the bottom stays clear: a ring opened low (the +, or a
  // card's lower edge) used to put its bottom face on top of the hint text
  const cy = Math.min(Math.max(fy, reach + 40), hostH - reach - HINT_ROOM);

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
  // Release decides: on a face, that face. Back in the middle after pushing
  // out, a change of mind — the ring closes and nothing is picked. Released
  // without ever moving, it stays up to be tapped (the fallback for anyone who
  // holds but doesn't push).
  const everAimed = useRef(false);
  if (dragging && aimed !== null && keyIndex === null) everAimed.current = true;
  const wasDragging = useRef(dragging);
  useEffect(() => {
    if (wasDragging.current && !dragging) {
      if (aimedRef.current !== null) onCommit(MOODS[aimedRef.current].id);
      else if (everAimed.current) onCancel();
    }
    wasDragging.current = dragging;
  }, [dragging, onCommit, onCancel]);

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

  return createPortal(
    <>
      <motion.div
        className="ring-backdrop"
        onContextMenu={(e) => e.preventDefault()}
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
              // Hover aims only once the finger is up. While it's held, the push
              // decides: a ring nudged away from the edge can put a face right
              // under the finger, and hover-aim then committed that face on a
              // release that never moved.
              onPointerEnter={() => {
                if (!dragging) setKeyIndex(i);
              }}
              onPointerLeave={() => {
                if (!dragging) setKeyIndex(null);
              }}
              onClick={() => onCommit(m.id)}
              aria-label={`${m.label} — ${m.line}`}
              aria-pressed={picked === m.id}
            >
              {/* its own element, so the idle loop never fights the orbit spring */}
              {motionPref === "full" ? (
                <motion.span className="ring-face-anim" {...faceIdle(m.id, i, on)}>
                  <Face mood={m.id} size={30} />
                </motion.span>
              ) : (
                <Face mood={m.id} size={30} />
              )}
            </motion.button>
          );
        })}

        <motion.div
          className={`ring-label${labelBelow ? " below" : ""}`}
          style={{
            ...(labelBelow
              ? { top: RING + BUBBLE / 2 + 12 }
              : { bottom: RING + BUBBLE / 2 + 12 }),
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
            // one card for both lines: the description on its own, over busy
            // artwork, was the hardest thing on screen to read
            <span className="ring-label-card">
              <b style={{ color: lead.accent }}>{lead.label}</b>
              <small>{lead.line}</small>
            </span>
          ) : (
            <span>
              {dragging
                ? everAimed.current
                  ? "let go here to cancel"
                  : "push toward a face"
                : "tap a face"}
            </span>
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
          <span>{hint ?? "how does this one feel?"}</span>
        )}
      </motion.div>
    </>,
    frame,
  );
}
