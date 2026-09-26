import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { moodAtPush, MOODS, wedgePath, wedgePoint, type MoodId } from "../data/mood";
import type { Verdict } from "../data/predict";
import { Face } from "./faces";
import { faceIdle } from "./faceMotion";

/**
 * The mood ring — a wheel of six wedges around the thumb that summoned it.
 *
 * It started as six small bubbles on a faint orbit. They were hard to hit and
 * harder to read as one thing: loose buttons floating over the artwork, with
 * nothing showing how far each one's territory reached. The push rule already
 * gives every face a full 60 degrees (moodAtPush), so the ring now draws
 * exactly that — a solid donut split into six keys, like a game's emote
 * wheel. What you see is what the finger can hit.
 *
 * Designed around the thumb:
 *   - Centred on the fingertip, nudged inward near an edge only as far as it
 *     has to; directions never change, so the wheel becomes muscle memory.
 *   - The hole in the middle is where the thumb is. Pushing out aims a wedge;
 *     coming back into the hole and letting go cancels.
 *   - The aimed wedge fills with its colour and steps out toward the finger,
 *     and its name rides above the ring where the hand can't cover it.
 *   - Released without ever moving, it stays up to be tapped. Arrow keys walk
 *     it for anyone without a thumb.
 */

/** outer edge of the wheel, px */
const R_OUT = 116;
/** the hole — where the thumb sits */
const R_IN = 46;
/** where each face and its name sit along the wedge */
const FACE_R = 80;
/** the face rides a little above that point, the name a little below it —
    stacked, not radial, so the side wedges never run name into face */
const FACE_DY = -8;
const NAME_DY = 16;
/** trim on each side of a wedge, degrees — the dark seams between keys */
const GAP = 1.1;
/** how far the aimed wedge steps out */
const POP = 6;
/** push less than this and nothing is selected — release cancels */
const DEAD = 38;
/** room kept between the wheel and the frame edge */
const EDGE = 6;
/** height of the hint strip at the bottom, which the ring must not cover */
const HINT_ROOM = 44;
/** the svg canvas: the wheel plus room for the popped wedge and its glow */
const CANVAS = (R_OUT + POP + 14) * 2;

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
  downGain = 1,
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
  /** the line under everything; defaults to the card's "what are you in the mood for?" */
  hint?: string;
  /** how much more a downward push counts (the + ring sits near the bottom; see PLUS_DOWN_GAIN) */
  downGain?: number;
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
  const reach = R_OUT + POP + EDGE;
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
    const mood = moodAtPush(pointer.x - origin.x, pointer.y - origin.y, DEAD, downGain);
    return mood === null ? null : MOODS.findIndex((m) => m.id === mood);
  }, [pointer, keyIndex, origin.x, origin.y, downGain]);

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
  const labelBelow = cy - R_OUT - 64 < 0;

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
        {/* the wheel: six wedges, one per push direction */}
        <motion.div
          className="ring-wheel"
          style={{ width: CANVAS, height: CANVAS, marginLeft: -CANVAS / 2, marginTop: -CANVAS / 2 }}
          initial={{ scale: instant ? 1 : 0.5, rotate: instant ? 0 : -24, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          exit={{ scale: instant ? 1 : 0.7, opacity: 0, transition: { duration: 0.12 } }}
          transition={{ type: "spring", stiffness: 460, damping: 30 }}
        >
          <svg
            width={CANVAS}
            height={CANVAS}
            viewBox={`${-CANVAS / 2} ${-CANVAS / 2} ${CANVAS} ${CANVAS}`}
            aria-hidden="true"
          >
            {/* the rim: one thin line round the outside makes six keys one object */}
            <circle className="ring-rim" r={R_OUT + 3} />
            {MOODS.map((m, i) => {
              const on = aimed === i;
              const out = wedgePoint(i, on ? POP : 0);
              return (
                <g
                  key={m.id}
                  className={`ring-wedge${on ? " on" : ""}${active === m.id ? " lens" : ""}`}
                  style={{ ["--face" as string]: m.accent, transform: `translate(${out.x}px, ${out.y}px)` }}
                  onPointerEnter={() => {
                    if (!dragging) setKeyIndex(i);
                  }}
                  onPointerLeave={() => {
                    if (!dragging) setKeyIndex(null);
                  }}
                  onClick={() => onCommit(m.id)}
                >
                  <path d={wedgePath(i, R_IN, R_OUT, GAP)} />
                  {picked === m.id && (
                    // what you already said about this song: a dot on the rim
                    <circle className="ring-picked" r={3.5} cx={wedgePoint(i, R_OUT - 9).x} cy={wedgePoint(i, R_OUT - 9).y} />
                  )}
                  <text
                    className="ring-name"
                    x={wedgePoint(i, FACE_R).x}
                    y={wedgePoint(i, FACE_R).y + NAME_DY}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {m.label}
                  </text>
                </g>
              );
            })}
            {/* the hole's edge; the aimed direction lights the arc facing it */}
            <circle className="ring-hole" r={R_IN - 6} />
            {aimed !== null && (
              <path
                className="ring-pointer"
                style={{ ["--face" as string]: MOODS[aimed].accent }}
                d={wedgePath(aimed, R_IN - 7.5, R_IN - 4.5, 8)}
              />
            )}
            {dragging && aimed === null && everAimed.current && (
              // back in the middle: this is where letting go cancels
              <g className="ring-cancel">
                <path d="M -7 -7 L 7 7 M 7 -7 L -7 7" />
              </g>
            )}
          </svg>
        </motion.div>

        {MOODS.map((m, i) => {
          const on = aimed === i;
          const p = wedgePoint(i, FACE_R + (on ? POP : 0));
          return (
            <motion.button
              key={m.id}
              type="button"
              className={`ring-face${on ? " on" : ""}`}
              style={{ ["--face" as string]: m.accent }}
              // out of the fingertip and into the wheel
              initial={{ x: 0, y: 0, scale: instant ? 1 : 0.3, opacity: 0 }}
              animate={{ x: p.x, y: p.y + FACE_DY, scale: on ? 1.18 : 1, opacity: 1 }}
              exit={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 560,
                damping: 30,
                delay: instant ? 0 : 0.03 + i * 0.02,
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
              {/* its own element, so the idle loop never fights the spring */}
              {motionPref === "full" ? (
                <motion.span className="ring-face-anim" {...faceIdle(m.id, i, on)}>
                  <Face mood={m.id} size={30} animated delay={i * 0.13} />
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
              ? { top: R_OUT + 16 }
              : { bottom: R_OUT + 16 }),
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
          <span>{hint ?? "what are you in the mood for?"}</span>
        )}
      </motion.div>
    </>,
    frame,
  );
}
