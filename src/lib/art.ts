/**
 * iTunes artwork URLs encode their size (".../600x600bb.jpg") and the CDN
 * serves any resolution. Decoded bitmaps live in RAM at full size, so a 46px
 * list row must not pay for a 600px image — request what we render.
 */
export function art(url: string, px: number): string {
  return url.replace(/\d+x\d+(bb)?\.jpg/, `${px}x${px}$1.jpg`);
}
