/**
 * The swipe tour's words and its one decision, shared by the web tour and the
 * phone tour (mirrored byte-for-byte — mobile/scripts/check-mirrors.mjs fails
 * the build if the copies drift). The two tours had quietly diverged: the
 * phone said "Show me how" where the web said "Let's start", cut half of each
 * explanation, and lost the button that moves past the taste questions — so on
 * a phone the only way off "what do you listen in?" was skipping the tour.
 */

/** A headline is a plain lead and the accented end (the web's <em>). */
export interface TourHeadline {
  lead: string;
  accent: string;
}

export const TOUR_COPY = {
  welcome: {
    headline: { lead: "your next favorite song is", accent: "one swipe away" },
    copy: "We play you the best part of songs you've never heard. Four swipes teach us exactly what you love.",
  },
  languages: {
    headline: { lead: "what do you listen", accent: "in?" },
    copy: "Pick as many as you like. This matters more than genre — being fed songs in a language you don't speak gets old fast.",
  },
  genres: {
    headline: { lead: "and what", accent: "sounds?" },
    copy: "A rough steer, not a filter — everything else still shows up, just further down the deck.",
  },
  adventure: {
    headline: { lead: "how far", accent: "off the map?" },
  },
  hold: {
    copy: "Hold the card, push toward a face, let go. The whole deck switches to that mood — every song that fits comes first — until you tap the mood to clear it.",
  },
  start: "Let's start",
  skip: "Skip the tour",
} as const satisfies Record<string, unknown>;

/**
 * The button under a taste question (steps 1–3). Never blocked on an answer —
 * an empty one simply tilts nothing — but it says so: "Skip this" while a
 * multi-pick question has no picks, "Next" otherwise.
 */
export function tasteStepButton(
  step: number,
  picked: { languages: readonly string[]; genres: readonly string[] },
): "Skip this" | "Next" {
  if (step === 1 && picked.languages.length === 0) return "Skip this";
  if (step === 2 && picked.genres.length === 0) return "Skip this";
  return "Next";
}
