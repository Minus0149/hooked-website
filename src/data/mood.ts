/**
 * Mood: the dimension the deck was missing.
 *
 * Everything that ranked the deck until now answers "what kind of music is
 * this person into" — language, genre, how played a song is, who else reacted
 * to it. None of it answers "what do they want *right now*", and those are
 * different questions with different answers. The same listener wants a
 * different song at 2pm on a Friday than at 1am on a Tuesday, and no amount of
 * knowing their taste tells you which one it is.
 *
 * Moods are laid out on Russell's plane, the two axes affective research has
 * used for forty years:
 *
 *   energy  (arousal)  — how activating the song is. Measurable from audio.
 *   valence (pleasure) — how happy it sounds. Not measurable from audio
 *                        without a trained classifier, so it is inferred here.
 *
 * Two axes, not a list of words, because the axes are what make the arithmetic
 * work: "close to what they asked for" is a distance, and a time of day is a
 * point rather than a category. The six faces are the corners of that plane a
 * person can actually name.
 *
 * Grounded, not invented:
 *   - Self-reported mood beats no mood. A 2026 study conditioning a ranker on
 *     a mood the listener picked from a small set of faces measured 3.59 vs
 *     2.67 mean rating against an unconditioned baseline (p ~ 0.01), with the
 *     largest gains on the low-arousal moods — which is exactly the ask here.
 *   - Listening is diurnal. Post-midnight listening skews to LOW AROUSAL (and,
 *     notably, not to low valence — late-night is quiet, not miserable), while
 *     loudness peaks around noon. That is the shape of DAYPART_ENERGY below,
 *     and it is why the late-night suggestion is "sleepy" and not "sad".
 *
 * Mirrored in mobile/src/data/mood.ts. Two clients that disagree about what
 * "party" means are two different products.
 */

import { flattenGenre, GENRES } from "./taste";

export type MoodId = "party" | "hyped" | "sunny" | "chill" | "tender" | "sleepy";

export interface Mood {
  id: MoodId;
  /** what the face is called, out loud */
  label: string;
  /** one line, shown under the label — the promise, not the definition */
  line: string;
  /** Russell's plane, both 0..1 */
  energy: number;
  valence: number;
  /**
   * Genre substrings that ARE this mood, matched letters-only so "hip hop",
   * "hip-hop/rap" and "Hip-Hop" are one thing. Overlap between moods is
   * deliberate: a ghazal is tender and nearly sleepy, and moodFit grades
   * rather than decides.
   */
  match: string[];
  /** the face's own colour, used for the fan and the active chip */
  accent: string;
}

/**
 * Six, ordered by energy, loudest first.
 *
 * The fan draws them along an arc in this order, so the gesture has a
 * direction a hand can learn: up the arc is louder, down it is quieter. Never
 * reorder this for looks — the muscle memory is the feature, and a test holds
 * the order to the energy values so the two can't drift apart.
 */
export const MOODS: Mood[] = [
  {
    id: "hyped",
    label: "Hyped",
    line: "shoulders back, volume up",
    energy: 0.95,
    valence: 0.5,
    match: [
      "hip hop", "hip-hop", "rap", "drill", "trap", "phonk", "grime",
      "metal", "punk", "hardcore", "rock", "classic rock", "alt rock",
      "desi hip hop", "sertanejo",
    ],
    accent: "#ff7a29",
  },
  {
    id: "party",
    label: "Party",
    line: "loud room, no thinking",
    energy: 0.92,
    valence: 0.82,
    match: [
      "dance", "house", "techno", "edm", "electronic", "club", "disco",
      "reggaeton", "bhangra", "punjabi", "afrobeats", "afro house",
      "funk carioca", "baile", "amapiano", "garage", "trance",
      "calypso", "soca",
    ],
    accent: "#ff4d8d",
  },
  {
    id: "sunny",
    label: "Sunny",
    line: "good mood, keep it there",
    energy: 0.62,
    valence: 0.9,
    match: [
      "pop", "alt pop", "k-pop", "kpop", "latin pop", "indian pop",
      "bollywood", "kollywood", "funk", "soul", "motown", "reggae",
      "afropop", "mandopop", "j-pop", "synthpop",
      "tamil", "telugu", "malayalam", "regional indian", "country", "worldbeat",
    ],
    accent: "#ffd23f",
  },
  {
    id: "chill",
    label: "Chill",
    line: "easy, warm, in the background",
    energy: 0.35,
    valence: 0.68,
    match: [
      "indie folk", "folk", "acoustic", "lo-fi", "lofi", "downtempo",
      "chillout", "r&b", "rnb", "bossa", "jazz", "singer/songwriter",
      "psych pop", "indie", "alternative", "americana", "soft rock",
      "country", "celtic",
    ],
    accent: "#4fd1c5",
  },
  {
    id: "tender",
    label: "Tender",
    line: "the sad ones, on purpose",
    energy: 0.28,
    valence: 0.26,
    match: [
      "ghazal", "ghazals", "sufi", "qawwali", "ballad", "blues", "sad",
      "adult contemporary", "arabic", "egyptian pop", "soundtrack",
      "singer/songwriter", "gospel", "fado",
      "original score",
    ],
    accent: "#8b7cff",
  },
  {
    id: "sleepy",
    label: "Sleepy",
    line: "lights off, volume down",
    energy: 0.14,
    valence: 0.5,
    match: [
      "ambient", "instrumental", "classical", "indian classical",
      "carnatic", "hindustani", "devotional", "bhajan", "meditation",
      "new age", "piano", "sleep", "instrumental hip hop", "drone",
    ],
    accent: "#5b8def",
  },
];

export const MOOD_IDS = MOODS.map((m) => m.id);

export const moodById = (id: MoodId | null | undefined): Mood | null =>
  MOODS.find((m) => m.id === id) ?? null;

/** Narrow anything persisted, typed by hand, or sent by a server. */
export function coerceMood(raw: unknown): MoodId | null {
  return typeof raw === "string" && MOOD_IDS.includes(raw as MoodId)
    ? (raw as MoodId)
    : null;
}

/* ------------------------------------------------------------------ crowd */

/**
 * What other listeners said a track feels like: track id -> mood -> votes.
 *
 * Sparse and small on purpose. It arrives from `mood.crowd`, which only
 * returns moods several separate people agreed on, so most tracks are absent
 * and a young catalogue has none of this at all. Absent means "nobody has
 * said", which is a different thing from "it is not that mood".
 */
export type CrowdMoods = Record<string, Partial<Record<MoodId, number>>>;

/** Votes needed before a crowd tag is taken as seriously as a genre match. */
const CROWD_CONFIDENT = 4;

/* -------------------------------------------------------------------- fit */

export interface MoodTrack {
  genre: string;
  /**
   * Measured arousal, 0..1, written by the offline analyser from the same
   * loudness and onset curves it already computes to find hooks (see
   * scripts/lib/hook-detector.mjs). Absent for anything not yet analysed,
   * which is most of a fresh catalogue.
   */
  energy?: number;
  /** how the audio reads on each mood, MOOD_IDS order; see types.ts */
  audioMood?: number[];
}

/**
 * How well a track answers a mood, 0..1.
 *
 * Three signals, weighted by how much each deserves to be trusted, and
 * averaged over only the ones that exist for this track. A weighted average
 * rather than a sum, so a track with no crowd votes and no analysis isn't
 * penalised for what we failed to measure — it is simply judged on its genre.
 *
 * The order of trust is the point:
 *   people who listened to it (1.6) > a model that listened to it (1.2)
 *     > how it is filed (1.0) > how loud it is (0.7)
 *
 * A crowd tag outranks a genre string because genre is a retail category and
 * mood is an experience: Apple files half of Bollywood under one word, and
 * that word covers both a wedding banger and a funeral. Loudness comes last
 * because it is real but blunt — plenty of quiet songs are devastating.
 */
export function moodFit(
  track: MoodTrack,
  mood: Mood,
  crowd?: Partial<Record<MoodId, number>>,
): number {
  let weight = 0;
  let total = 0;

  if (crowd) {
    const votes = MOOD_IDS.reduce((n, id) => n + (crowd[id] ?? 0), 0);
    if (votes > 0) {
      // share of the vote, damped while the sample is tiny: two people calling
      // something a party is a hint, ten is a fact
      const share = (crowd[mood.id] ?? 0) / votes;
      const w = 1.6 * Math.min(votes / CROWD_CONFIDENT, 1);
      total += w * share;
      weight += w;
    }
  }

  const genre = flattenGenre(track.genre ?? "");
  if (genre.length > 0) {
    const hit = mood.match.some((m) => genre.includes(flattenGenre(m)));
    total += 1.0 * (hit ? 1 : 0);
    weight += 1.0;
  }

  // The analyser's reading of the audio itself. Relative to the track's own
  // strongest mood, so a song that is clearly "tender" scores 1 there even if
  // the model spread some probability elsewhere.
  if (Array.isArray(track.audioMood) && track.audioMood.length === MOOD_IDS.length) {
    const top = Math.max(...track.audioMood);
    const at = track.audioMood[MOOD_IDS.indexOf(mood.id)];
    if (top > 0 && Number.isFinite(at)) {
      total += 1.2 * Math.max(0, at / top);
      weight += 1.2;
    }
  }

  if (typeof track.energy === "number" && Number.isFinite(track.energy)) {
    const energy = Math.min(Math.max(track.energy, 0), 1);
    // distance on one axis; 1 when it lands on the mood, 0 at the far end
    total += 0.7 * (1 - Math.abs(energy - mood.energy));
    weight += 0.7;
  }

  return weight === 0 ? 0 : total / weight;
}

/**
 * The same thing for a catalogue track and the active lens, looking the crowd's
 * votes up by id. This is the form the ranker calls.
 */
export function moodFitFor(
  track: MoodTrack & { id: string },
  id: MoodId | null,
  crowd?: CrowdMoods,
): number {
  const mood = moodById(id);
  if (!mood) return 0;
  return moodFit(track, mood, crowd?.[track.id]);
}

/**
 * Which mood a track reads as, strongest first. Used to describe a song ("this
 * one's tender") and to feed the taste model a mood feature.
 */
export function moodsOf(
  track: MoodTrack,
  crowd?: Partial<Record<MoodId, number>>,
  floor = 0.5,
): MoodId[] {
  return MOODS.map((m) => ({ id: m.id, fit: moodFit(track, m, crowd) }))
    .filter((m) => m.fit >= floor)
    .sort((a, b) => b.fit - a.fit)
    .map((m) => m.id);
}

/* ---------------------------------------------------------------- daypart */

export type Daypart = "lateNight" | "morning" | "afternoon" | "evening" | "night";

/**
 * Five blocks. The literature usually cuts the day into four; the fifth is the
 * one that matters most here, because "1am" and "10pm" are not the same
 * listening session and India's late-night block is where the quiet music is.
 *
 * Boundaries are half-open [from, to) on the local clock. Local is the whole
 * point — a daypart computed on the server would be the VPS's opinion of what
 * time it is, which is a different continent's evening.
 */
const BLOCKS: { part: Daypart; from: number; to: number }[] = [
  { part: "lateNight", from: 0, to: 5 },
  { part: "morning", from: 5, to: 12 },
  { part: "afternoon", from: 12, to: 17 },
  { part: "evening", from: 17, to: 22 },
  { part: "night", from: 22, to: 24 },
];

export function daypartAt(when: Date = new Date()): Daypart {
  const h = when.getHours();
  return BLOCKS.find((b) => h >= b.from && h < b.to)?.part ?? "morning";
}

/**
 * The arousal curve of a day, which is the part that is actually evidenced:
 * loudness peaks around midday, and post-midnight listening drops to low
 * arousal without dropping to low valence.
 */
export const DAYPART_ENERGY: Record<Daypart, number> = {
  lateNight: 0.18,
  morning: 0.55,
  afternoon: 0.9,
  evening: 0.88,
  night: 0.35,
};

/**
 * The face the app offers unprompted, per block.
 *
 * "Suggest" is the operative word — see MOOD_BY_TIME. An app that silently
 * filtered the deck by the clock would read as broken ("where did my music
 * go"), and would be wrong for everyone who works nights.
 */
export const DAYPART_MOOD: Record<Daypart, MoodId> = {
  lateNight: "sleepy",
  morning: "sunny",
  afternoon: "hyped",
  evening: "party",
  night: "tender",
};

export const DAYPART_COPY: Record<Daypart, { label: string; nudge: string }> = {
  lateNight: { label: "late", nudge: "It's late. Something quiet?" },
  morning: { label: "morning", nudge: "Morning. Start it bright?" },
  afternoon: { label: "afternoon", nudge: "Afternoon slump. Something loud?" },
  evening: { label: "evening", nudge: "Evening. Turn it up?" },
  night: { label: "night", nudge: "Winding down. The slow ones?" },
};

/**
 * Moods ordered by how well they suit the hour: nearest the block's energy
 * first. The suggested face still leads — this is what fills the row behind it,
 * so at 1am the quiet faces come before the loud ones without hiding any.
 */
export function moodsForHour(when: Date = new Date()): Mood[] {
  const part = daypartAt(when);
  const target = DAYPART_ENERGY[part];
  const lead = DAYPART_MOOD[part];
  return [...MOODS].sort((a, b) => {
    if (a.id === lead) return -1;
    if (b.id === lead) return 1;
    return Math.abs(a.energy - target) - Math.abs(b.energy - target);
  });
}

/** How the clock is allowed to touch the deck. A preference, default "suggest". */
export type MoodByTime = "off" | "suggest" | "always";

export const MOOD_BY_TIME: { id: MoodByTime; label: string; copy: string }[] = [
  { id: "off", label: "Off", copy: "The clock never touches the deck" },
  {
    id: "suggest",
    label: "Suggest",
    copy: "Offer a mood for the hour; tap to take it",
  },
  {
    id: "always",
    label: "Always on",
    copy: "Lean the deck toward the hour without asking",
  },
];

export function coerceMoodByTime(raw: unknown): MoodByTime {
  return raw === "off" || raw === "always" || raw === "suggest" ? raw : "suggest";
}

/* ---------------------------------------------------------------- helpers */

/**
 * The genre buckets that overlap a mood, for copy like "party — dance, house".
 * Reads the same GENRES the onboarding offers, so the two surfaces can't
 * describe the catalogue differently.
 */
export function bucketsForMood(mood: Mood): string[] {
  return GENRES.filter((g) =>
    g.match.some((gm) =>
      mood.match.some((mm) => flattenGenre(mm).includes(flattenGenre(gm))),
    ),
  ).map((g) => g.label);
}

/* ---------------------------------------------------------------- the wheel */

/**
 * Where each face sits on the emote wheel, and which one a push lands on.
 *
 * This is product judgement, not rendering: "up is hyped, down-left is tender"
 * has to be the same sentence on both clients or the gesture means two things.
 * Kept here, mirrored, rather than in either client's wheel component.
 *
 * Face i is centred at -90 + i * 60 degrees — index 0 straight up, then
 * clockwise in MOODS order, so the loudest faces are the top of the wheel and
 * the quietest are the bottom.
 */
export const WHEEL_START_DEG = -90;
export const WHEEL_STEP_DEG = 360 / 6;

/** Where face `i` sits, in degrees, 0 = three o'clock, clockwise positive. */
export function wheelAngle(i: number): number {
  return WHEEL_START_DEG + i * WHEEL_STEP_DEG;
}

/**
 * The wedge face `i` owns on the ring, as an SVG path: an annular sector from
 * `rIn` to `rOut`, centred on (0, 0), trimmed by `gapDeg` on each side so the
 * wedges read as separate keys.
 *
 * The wedge IS the push target — every direction inside its 60 degrees picks
 * it (moodAtPush) — so drawing the whole sector rather than a small bubble
 * shows the finger exactly how much room it has.
 */
export function wedgePath(i: number, rIn: number, rOut: number, gapDeg = 0): string {
  const mid = wheelAngle(i);
  const half = WHEEL_STEP_DEG / 2 - gapDeg;
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt = (r: number, d: number) =>
    `${+(Math.cos(rad(d)) * r).toFixed(2)} ${+(Math.sin(rad(d)) * r).toFixed(2)}`;
  const a0 = mid - half;
  const a1 = mid + half;
  return (
    `M ${pt(rOut, a0)} A ${rOut} ${rOut} 0 0 1 ${pt(rOut, a1)} ` +
    `L ${pt(rIn, a1)} A ${rIn} ${rIn} 0 0 0 ${pt(rIn, a0)} Z`
  );
}

/** A point `r` out along face `i`'s bisector — where its face and label sit. */
export function wedgePoint(i: number, r: number): { x: number; y: number } {
  const a = (wheelAngle(i) * Math.PI) / 180;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/**
 * Which mood a push of (dx, dy) selects, or null for "not far enough yet".
 *
 * `deadZone` is in the same units as dx/dy. Releasing inside it cancels, which
 * is the escape hatch: a gesture you cannot back out of is a trap, and opening
 * the wheel to see what it does is the most common first use of it.
 */
export function moodAtPush(
  dx: number,
  dy: number,
  deadZone: number,
): MoodId | null {
  if (Math.sqrt(dx * dx + dy * dy) < deadZone) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const shifted =
    (deg - WHEEL_START_DEG + WHEEL_STEP_DEG / 2 + 720) % 360;
  const i = Math.floor(shifted / WHEEL_STEP_DEG) % MOODS.length;
  return MOODS[i].id;
}

/**
 * What a mood playlist made from the + is called. One name per mood, so
 * holding + and picking the same face again finds it instead of making a
 * second "Party mix".
 */
export function moodPlaylistName(mood: MoodId): string {
  const face = moodById(mood);
  return face ? `${face.label} mix` : "Mood mix";
}


/**
 * How each face moves while a ring is open — a personality, not a spinner.
 * Six faces bobbing the same way read as one loading animation; each moving
 * the way its mood feels reads as six choices. Shared by both clients so the
 * phone and the browser animate the same faces the same way.
 */
export const FACE_IDLE: Record<
  MoodId,
  { keyframes: Partial<Record<"x" | "y" | "rotate" | "scale", number[]>>; duration: number }
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

/** The aimed face moves faster (it's excited to be picked); faces start out of phase. */
export function faceIdleTiming(index: number, aimed: boolean, duration: number) {
  return { duration: aimed ? duration * 0.55 : duration, delay: 0.25 + index * 0.13 };
}
