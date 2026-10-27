/**
 * What a first-time visitor reads before the tour starts: three plain facts
 * under the promise, and the questions people ask before they trust a music
 * app. Every line here is something the code does today — no user counts, no
 * ratings, no testimonials (HookedCue is a small invite-only beta, and
 * tests/landing-copy.test.ts keeps it that way).
 *
 * index.html paints the same facts before the app's script has loaded, so the
 * first screen shows up at HTML speed; the test keeps the two copies equal.
 */

/** Under the welcome headline. Short enough to sit on one line at 375 px. */
export const LANDING_FACTS = ["Free", "Starts at the hook", "Invite-only beta"] as const;

/** The live catalogue size, rounded down to the hundred: "6,300+ songs". */
export function songCountLabel(count: number): string | null {
  if (!Number.isFinite(count) || count < 500) return null;
  const floor = Math.floor(count / 100) * 100;
  return `${floor.toLocaleString("en-US")}+ songs`;
}

export const FAQ_LINK = "Questions? Is it free, which songs, why 30 seconds";

export const LANDING_FAQ: readonly { q: string; a: string }[] = [
  {
    q: "Is it free?",
    a: "Yes. Swiping, saving songs and making playlists cost nothing, and there is no subscription.",
  },
  {
    q: "Do I need an account?",
    a: "Not to try it: you get five free swipes first. Saving songs needs an account, and accounts are invite-only while we test. Leave your email at the end and we'll send an invite.",
  },
  {
    q: "Which songs are in it?",
    a: "Songs from music charts around the world, plus songs artists upload themselves. Hindi, Punjabi, Tamil, Telugu, English, Korean, Spanish and more. You pick your languages on the next screen.",
  },
  {
    q: "Why 30-second previews?",
    a: "Each song plays the 30-second preview Apple publishes for it, streamed straight from Apple. HookedCue starts it at the song's hook, so you hear the part that matters first. Any song opens in Apple Music, Spotify or YouTube when you want the whole thing.",
  },
  {
    q: "What do the swipes do?",
    a: "Up skips, down saves, right asks for more like it, left means never again for that artist. Hold a card to pick a mood. Every swipe changes what comes next.",
  },
  {
    q: "Is there a phone app?",
    a: "The Android app is in closed testing on Google Play. This web app works in any phone or desktop browser. There is no iPhone app yet.",
  },
];

export const PRIVACY_URL = "https://hookedcue.com/privacy";
