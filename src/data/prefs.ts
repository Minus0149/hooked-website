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
}

export const DEFAULT_PREFS: UserPrefs = {
  motion: "full",
  haptics: "subtle",
  accentMode: "track",
  accentColor: "#FF3D71",
  swipeSensitivity: 1,
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
  return out;
}
