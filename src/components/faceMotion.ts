import { FACE_IDLE, faceIdleTiming, type MoodId } from "../data/mood";

/**
 * Motion props for a face's idle loop in the ring. The table itself lives in
 * data/mood.ts, mirrored to the phone, so both clients move each face alike.
 *
 * Driven by Motion rather than CSS on purpose: the stylesheet's
 * prefers-reduced-motion block flattens every CSS animation, and some machines
 * report that setting permanently. The ring follows the in-app motion
 * preference instead ("full" only), which the listener actually controls.
 */
export { FACE_IDLE };

export function faceIdle(mood: MoodId, index: number, aimed: boolean) {
  const idle = FACE_IDLE[mood];
  const timing = faceIdleTiming(index, aimed, idle.duration);
  return {
    animate: idle.keyframes,
    transition: {
      duration: timing.duration,
      delay: timing.delay,
      repeat: Infinity,
      ease: "easeInOut" as const,
    },
  };
}
