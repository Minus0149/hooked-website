/**
 * Which text colour reads on a given accent: near-black or white, whichever
 * has the higher WCAG contrast ratio against it.
 *
 * The accent follows each song's artwork, or a colour the listener picked,
 * so a filled button can be anything from deep violet to lemon. White text on
 * a yellow or mint accent was close to unreadable.
 */
export const INK = "#0B0B10";
export const PAPER = "#FFFFFF";

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Relative luminance of a #rgb / #rrggbb colour; null if it isn't one. */
export function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** The text colour for something filled with `accent`. */
export function inkOn(accent: string): string {
  const l = luminance(accent);
  if (l === null) return PAPER;
  const onInk = contrast(l, luminance(INK)!);
  const onPaper = contrast(l, 1);
  return onInk > onPaper ? INK : PAPER;
}
