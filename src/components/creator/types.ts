import type { Id } from "../../../convex/_generated/dataModel";

/** Shapes and time helpers the creator screens share. */
export const MS = (s: number) => Math.round(s * 1000);
export const secs = (ms: number) => (ms / 1000).toFixed(1).replace(/\.0$/, "");
export const clock = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export type Hook = {
  _id: Id<"hooks">;
  startMs: number;
  durationMs: number;
  label?: string;
  order: number;
  active: boolean;
  // written by the hourly ranking job; absent until a hook has earned one
  rank?: number;
  // joined from hookStats - they are not stored on the hook itself
  plays: number;
  saves: number;
  skips: number;
};

export type Track = {
  _id: Id<"tracks">;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  previewUrl: string;
  durationMs: number;
  genre: string;
  accent: string;
  hidden?: boolean;
  audioUrl: string | null;
  audioDurationMs?: number;
  /** set when the uploader ticked the rights box on an attached upload */
  rightsConfirmedAt?: string;
  hooks: Hook[];
};
