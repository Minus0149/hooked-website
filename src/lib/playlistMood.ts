import { moodPlaylistName, type MoodId } from "../data/mood";

/**
 * What the new-playlist name box holds after a mood is picked.
 *
 * Picking a mood fills in its name ("Chill mix") — but only over an empty box
 * or a name the previous mood filled in. A name the listener typed is theirs
 * and is never replaced; picking "Any" clears only a filled-in name.
 */
export function nameAfterMoodPick(
  current: string,
  lastFilled: string,
  mood: MoodId | null,
): { name: string; filled: string } {
  const ours = !current.trim() || current === lastFilled;
  if (!ours) return { name: current, filled: "" };
  const filled = mood ? moodPlaylistName(mood) : "";
  return { name: filled, filled };
}
