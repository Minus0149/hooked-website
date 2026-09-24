import type { MoodId } from "../data/mood";

/**
 * How each face moves while the ring is open — a personality, not a spinner.
 * Six faces all bobbing the same way read as one loading animation; each one
 * moving the way its mood feels reads as six choices.
 *
 * Driven by Motion rather than CSS on purpose: the stylesheet's
 * prefers-reduced-motion block flattens every CSS animation, and some machines
 * report that setting permanently. These follow the in-app motion preference
 * instead ("full" only), which the listener actually controls.
 */
export const FACE_IDLE: Record<
  MoodId,
  { keyframes: Record<string, number[]>; duration: number }
> = {
  // can't keep still
  hyped: { keyframes: { y: [0, -5, 0], scale: [1, 1.1, 1] }, duration: 0.7 },
  // dancing
  party: { keyframes: { rotate: [-12, 12, -12] }, duration: 0.9 },
  // beaming
  sunny: { keyframes: { rotate: [0, 9, 0, -9, 0], scale: [1, 1.07, 1, 1.07, 1] }, duration: 2.4 },
  // swaying, unbothered
  chill: { keyframes: { x: [-2, 2, -2], rotate: [-4, 4, -4] }, duration: 3 },
  // a slow breath in
  tender: { keyframes: { scale: [1, 0.9, 1], y: [0, 1.5, 0] }, duration: 2.6 },
  // nodding off, then catching itself
  sleepy: { keyframes: { rotate: [0, -16, -16, 0], y: [0, 2, 2, 0] }, duration: 3.6 },
};

/** The aimed face moves faster: it's excited to be picked. */
export function faceIdle(mood: MoodId, index: number, aimed: boolean) {
  const idle = FACE_IDLE[mood];
  return {
    animate: idle.keyframes,
    transition: {
      duration: aimed ? idle.duration * 0.55 : idle.duration,
      repeat: Infinity,
      ease: "easeInOut" as const,
      // out of phase, so the ring never moves as one block
      delay: 0.25 + index * 0.13,
    },
  };
}
