/**
 * The saved volume, read back from device storage. Shared by the web player and
 * the phone app (mirrored — mobile/scripts/check-mirrors.mjs fails if the two
 * copies drift).
 *
 * Nothing saved comes back as null, and Number(null) is 0: read naively, every
 * fresh install starts muted. The web learned that early; the phone app kept
 * the naive read, so a new install played every preview silently until someone
 * found Settings → Playback → Volume. Anything unusable means full volume.
 */
export function storedVolume(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") return 1;
  const saved = Number(raw);
  return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 1;
}
