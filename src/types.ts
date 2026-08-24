/** A window into a track's audio. A preview supports one; full audio supports several. */
export interface HookWindow {
  id: string;
  startMs: number;
  durationMs: number;
  label?: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  previewUrl: string;
  durationMs: number;
  genre: string;
  accent: string;
  /** full uploaded audio, when the rights holder gave us the whole track */
  audioUrl?: string;
  /** ordered hooks. Empty or absent means "play the preview from the top". */
  hooks?: HookWindow[];
  /** iTunes storefronts this charted in — the language signal */
  markets?: string[];
  /** play count normalised 0..1 against the catalogue's leader (hourly job) */
  heat?: number;
}

export type SwipeAction = "skip" | "save" | "more" | "never";
export type SwipeDir = "up" | "down" | "right" | "left";
/** "liked" | "discoveries" | "pl:<playlistId>" */
export type SaveTarget = "liked" | "discoveries" | `pl:${string}`;

export interface Playlist {
  id: string;
  name: string;
  accent: string;
  tracks: Track[];
}

export type LibraryContainer = "liked" | "discoveries" | `pl:${string}`;

export const DIR_TO_ACTION: Record<SwipeDir, SwipeAction> = {
  up: "skip",
  down: "save",
  right: "more",
  left: "never",
};
