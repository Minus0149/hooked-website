/**
 * The numbers behind the frosted overlay backdrop (mood wheel, sheets).
 *
 * The web draws it as `background: rgba(3,3,5,a); backdrop-filter: blur(Npx)`.
 * The phone draws expo-blur's "dark" BlurView under its own tint, and these
 * make the two look the same. Mirrored from mobile/src/lib/backdrop.ts; the web copy
 * is the tested one (the phone has no test runner), and only the phone uses it.
 */

/** expo-blur intensity for a web `blur(Npx)` (its web build renders intensity × 0.2 px). */
export const intensityForPx = (px: number): number =>
  Math.max(0, Math.min(100, Math.round(px * 5)));

/**
 * The tint alpha to draw over a "dark" blur so the pair is as dark as the
 * web's single tint `dim`. expo-blur's dark tint already lays down
 * rgba(25,25,25, intensity/100 × 0.78); stacking the full `dim` on top of it
 * came out darker than the web.
 */
export function tintOver(dim: number, intensity: number): number {
  const blurAlpha = (Math.max(0, Math.min(100, intensity)) / 100) * 0.78;
  return Math.max(0, Math.min(1, 1 - (1 - dim) / (1 - blurAlpha)));
}
