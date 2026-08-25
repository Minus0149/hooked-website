/**
 * How the app should look and behave — the deeper Settings surface.
 *
 * These are preferences, not taste: taste tilts the deck, prefs shape the room
 * around it. They live on the profile so a sign-in carries them across
 * devices, but every field is local-first — the UI never waits on the network
 * to look right.
 */

export type MotionLevel = "full" | "reduced" | "off";
export type HapticsLevel = "off" | "subtle" | "full";
export type AccentMode = "track" | "custom";

export interface UserPrefs {
  /** Animation level: full choreography, calmer springs, or none at all. */
  motion: MotionLevel;
  /** Physical feedback strength (no-op where vibration is unavailable). */
  haptics: HapticsLevel;
  /** Tint the UI with each track's own accent, or hold one fixed colour. */
  accentMode: AccentMode;
  /** The fixed colour, as #rrggbb, when accentMode is "custom". */
  accentColor: string;
  /**
   * Multiplier on how far a card must travel before a swipe commits.
   * 0.6 = feather-light flicks, 1.4 = deliberate drags. 1 = shipped default.
   */
  swipeSensitivity: number;
  /** The listener asked to stop seeing house ads (reversible, with a word). */
  adsOptOut: boolean;
  /** Listener's own ad dial — how often cards may appear. Never denser than
   * what the admin allows; this can only space them further apart. */
  adFrequency: AdFrequency;
  /** The listener's exact cadence: per swipes, per minutes, per hours, or N
   * per day. null = follow the adFrequency preset. */
  adCadence: { unit: AdUnit; value: number } | null;
  /** Global discovery rules — the default strictness of the deck. Per-playlist
   * rules relax these further while that playlist is the save target. */
  allowRepeats: boolean;
  includeBuried: boolean;
  includeBlockedArtists: boolean;
}

export type AdFrequency = "often" | "normal" | "rarely";
export const AD_FREQUENCIES: { id: AdFrequency; label: string }[] = [
  { id: "often", label: "Often" },
  { id: "normal", label: "Normal" },
  { id: "rarely", label: "Rarely" },
];

export type AdUnit = "swipes" | "minutes" | "hours" | "day";
export const AD_UNITS: { id: AdUnit; label: string }[] = [
  { id: "swipes", label: "Swipes" },
  { id: "minutes", label: "Minutes" },
  { id: "hours", label: "Hours" },
  { id: "day", label: "Per day" },
];
/** bounds + stepper step per unit */
export const AD_UNIT_BOUNDS: Record<AdUnit, { min: number; max: number; step: number }> = {
  swipes: { min: 3, max: 200, step: 3 },
  minutes: { min: 1, max: 720, step: 5 },
  hours: { min: 1, max: 48, step: 1 },
  day: { min: 1, max: 10, step: 1 },
};

export function coerceAdCadence(raw: unknown): { unit: AdUnit; value: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { unit?: unknown; value?: unknown };
  if (
    (r.unit === "swipes" || r.unit === "minutes" || r.unit === "hours" || r.unit === "day") &&
    typeof r.value === "number" &&
    Number.isFinite(r.value)
  ) {
    const b = AD_UNIT_BOUNDS[r.unit];
    return { unit: r.unit, value: Math.min(Math.max(Math.round(r.value), b.min), b.max) };
  }
  return null;
}

export const DEFAULT_PREFS: UserPrefs = {
  motion: "full",
  haptics: "subtle",
  accentMode: "track",
  accentColor: "#FF3D71",
  swipeSensitivity: 1,
  adsOptOut: false,
  adFrequency: "normal",
  adCadence: null,
  allowRepeats: false,
  includeBuried: false,
  includeBlockedArtists: false,
};

export const MOTION_LEVELS: { id: MotionLevel; label: string }[] = [
  { id: "full", label: "Full" },
  { id: "reduced", label: "Reduced" },
  { id: "off", label: "Off" },
];

export const HAPTICS_LEVELS: { id: HapticsLevel; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "subtle", label: "Subtle" },
  { id: "full", label: "Pronounced" },
];

export const ACCENT_SWATCHES = [
  "#FF3D71",
  "#00E5A0",
  "#FFB627",
  "#7C5CFF",
  "#38BDF8",
  "#F472B6",
] as const;

export function coerceMotion(v: unknown): MotionLevel {
  return v === "reduced" || v === "off" || v === "full" ? v : DEFAULT_PREFS.motion;
}

export function coerceHaptics(v: unknown): HapticsLevel {
  return v === "off" || v === "subtle" || v === "full" ? v : DEFAULT_PREFS.haptics;
}

/** Narrow whatever the server stored back into a full UserPrefs. */
export function coercePrefs(raw: unknown): Partial<UserPrefs> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<UserPrefs> = {};
  out.motion = coerceMotion(r.motion);
  out.haptics = coerceHaptics(r.haptics);
  out.accentMode = r.accentMode === "custom" ? "custom" : "track";
  out.accentColor =
    typeof r.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(r.accentColor)
      ? r.accentColor.toUpperCase()
      : DEFAULT_PREFS.accentColor;
  out.swipeSensitivity =
    typeof r.swipeSensitivity === "number" &&
    Number.isFinite(r.swipeSensitivity) &&
    r.swipeSensitivity >= 0.6 &&
    r.swipeSensitivity <= 1.4
      ? Math.round(r.swipeSensitivity * 100) / 100
      : DEFAULT_PREFS.swipeSensitivity;
  out.adsOptOut = r.adsOptOut === true;
  out.adFrequency =
    r.adFrequency === "often" || r.adFrequency === "rarely"
      ? r.adFrequency
      : DEFAULT_PREFS.adFrequency;
  out.adCadence = coerceAdCadence(r.adCadence);
  out.allowRepeats = r.allowRepeats === true;
  out.includeBuried = r.includeBuried === true;
  out.includeBlockedArtists = r.includeBlockedArtists === true;
  return out;
}

