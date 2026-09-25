/**
 * The invite application, as data: shared by the web wall and the mobile one
 * (mirrored byte-for-byte — mobile/scripts/check-mirrors.mjs fails the build
 * if the two copies drift), so both apps ask the same things and answer the
 * server's reply the same way.
 *
 * Two steps. The first is only the email (name optional): sending it is the
 * whole application. The second — phone and what you play — is optional and is
 * sent as a second application for the same email, which the server uses only
 * to fill details left blank.
 */

export const ACCESS_GENRES = [
  "afrobeats", "psych pop", "bollywood", "house", "soul",
  "reggaeton", "indie folk", "k-pop", "hip hop", "classic rock",
  "punjabi", "electronic",
] as const;

export const MAX_ACCESS_GENRES = 8;

export type AccessStage = "form" | "details" | "sent" | "already" | "signin";

export interface ApplyResult {
  ok?: boolean;
  duplicate?: boolean;
  status?: string;
  message?: string;
}

/** Loose on purpose: the server validates properly; this only catches typos. */
export function emailLooksValid(email: string): boolean {
  return /^\S+@\S+\.\S+$/.test(email.trim());
}

/** Toggle a genre pill, never letting the list grow past the cap. */
export function toggleAccessGenre(list: string[], genre: string): string[] {
  if (list.includes(genre)) return list.filter((g) => g !== genre);
  return list.length < MAX_ACCESS_GENRES ? [...list, genre] : list;
}

/**
 * Where the first step leads. A new email goes on to the optional details; an
 * email already on file goes wherever its status says — approved people are
 * sent to sign in, pending ones may still add details, and anything else
 * (rejected) gets the "already" screen.
 */
export function stageAfterApply(data: ApplyResult): AccessStage {
  if (!data.duplicate) return "details";
  if (data.status === "approved") return "signin";
  if (data.status === "pending") return "details";
  return "already";
}

/** The body the apply route expects; blank optional fields are left out. */
export function applyBody(
  fields: { name: string; email: string; trap: string; startedAt: number },
  extra: { device?: string; notes?: string; genres?: string[] } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: fields.name.trim(),
    email: fields.email.trim(),
    website: fields.trap,
    startedAt: fields.startedAt,
  };
  const device = extra.device?.trim();
  const notes = extra.notes?.trim();
  if (device) body.device = device;
  if (notes) body.notes = notes;
  if (extra.genres && extra.genres.length > 0) body.genres = extra.genres;
  return body;
}
