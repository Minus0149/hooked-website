import type { MoodId } from "./data/mood";
﻿/** A window into a track's audio. A preview supports one; full audio supports several. */
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
  /**
   * Measured arousal, 0..1: how activating the recording sounds. Written by the
   * offline analyser from the loudness and onset curves it already computes to
   * find hooks, so it costs nothing extra and is a real measurement rather than
   * a guess from the genre string. Absent until a track has been analysed.
   */
  energy?: number;
  /**
   * What the recording sounds like: its CLAP audio embedding, projected to 32
   * numbers and packed as signed bytes in base64 (see data/sound.ts). Written
   * by scripts/analyze-sound.mjs; absent until a track has been heard.
   */
  sound?: string;
  /**
   * How the audio reads on each mood, in MOOD_IDS order (hyped, party, sunny,
   * chill, tender, sleepy), summing to ~1 — the model listening, calibrated
   * across the catalogue. Absent until analysed.
   */
  audioMood?: number[];
  /** 0..1, how sung (vs instrumental) the audio is. Absent until analysed. */
  vocal?: number;
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
  /** discovery rules — what the deck may deal while this playlist is the target */
  allowRepeats?: boolean;
  includeBuried?: boolean;
  includeBlockedArtists?: boolean;
  /** the mood it was made for — discovering into it puts that lens back on */
  mood?: MoodId;
}

export type LibraryContainer = "liked" | "discoveries" | `pl:${string}`;

export const DIR_TO_ACTION: Record<SwipeDir, SwipeAction> = {
  up: "skip",
  down: "save",
  right: "more",
  left: "never",
};

