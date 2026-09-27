import { useState } from "react";
import { motion } from "motion/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { moodById, type MoodId } from "../data/mood";
import { isRecapDay, recapStoryUrl } from "../lib/growth";
import { Face } from "./faces";

/**
 * "Your week in hooks" — on Home on Sundays and Mondays, for a listener with
 * an account and at least a few cards behind them this week. Only they see it
 * (convex/recap.ts reads their own swipes); sharing sends a picture of the
 * numbers, never the account.
 */
export function RecapCard() {
  const forced = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("recap") === "1";
  const show = forced || isRecapDay(new Date());
  const recap = useQuery(api.recap.week, show ? {} : "skip");
  const [note, setNote] = useState<string | null>(null);

  if (!show || !recap || !recap.ready) return null;

  const imageUrl = recapStoryUrl({
    firstName: recap.firstName,
    cards: recap.cards,
    saves: recap.saves,
    newArtists: recap.newArtists,
    saveRate: recap.saveRate,
    topMoods: recap.topMoods,
    topArtist: recap.topArtists[0] ?? null,
    until: recap.until,
  });

  const share = async () => {
    // the picture itself where the browser can share files (phones), else the link
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const file = new File([blob], "my-week-in-hooks.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "my week in hooks" });
        return;
      }
    } catch {
      // fall through to opening the image
    }
    window.open(imageUrl, "_blank", "noopener");
    setNote("Opened your card — save it and post it to your story");
  };

  const moods = recap.topMoods
    .map((id) => moodById(id as MoodId))
    .filter((m): m is NonNullable<ReturnType<typeof moodById>> => Boolean(m));

  return (
    <motion.section
      className="recap-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      aria-labelledby="recap-title"
    >
      <p className="recap-kicker" id="recap-title">your week in hooks</p>
      <p className="recap-big">
        <strong>{recap.cards}</strong> intros skipped
      </p>
      <p className="recap-sub">every one of them started at its hook</p>
      <div className="recap-stats">
        <span><strong>{recap.saves}</strong> saved</span>
        <span><strong>{recap.newArtists}</strong> new {recap.newArtists === 1 ? "artist" : "artists"}</span>
        <span><strong>{Math.round(recap.saveRate * 100)}%</strong> save rate</span>
      </div>
      {moods.length > 0 && (
        <div className="recap-moods">
          {moods.map((m) => (
            <span key={m.id} className="recap-mood" style={{ ["--face" as string]: m.accent }}>
              <Face mood={m.id} size={18} />
              {m.label}
            </span>
          ))}
        </div>
      )}
      {recap.topArtists[0] && <p className="recap-artist">on repeat: {recap.topArtists[0]}</p>}
      <button className="ob-primary recap-share" onClick={() => void share()}>
        Share your week
      </button>
      {note && <p className="recap-note" role="status">{note}</p>}
    </motion.section>
  );
}
