import { useState } from "react";
import type { AppState } from "../../state/store";
import { GroupLabel, Note, Row, Toggle } from "../ui";
import { art } from "../../lib/art";

/**
 * Which of your own lists are allowed back into the deck.
 *
 * The first version of this was a stack of identical toggle rows reading
 * "Liked songs — 12 songs · kept out of the deck". Correct, and unreadable:
 * every playlist looked the same, so the one decision that actually differs per
 * list — is this an archive or a rotation? — was the hardest thing to see.
 *
 * Now each list carries its own identity: its accent, the artwork already in
 * it, and its state in words. A playlist you built is a thing you recognise by
 * sight, so recognising it here should not require reading a label.
 */

type Container = {
  id: string;
  name: string;
  tracks: { id: string; artwork: string }[];
  accent: string;
};

function Cover({ tracks, accent }: { tracks: Container["tracks"]; accent: string }) {
  const shown = tracks.slice(0, 4);
  if (shown.length === 0) {
    return (
      <span
        className="rr-cover rr-cover-empty"
        style={{ background: `linear-gradient(140deg, ${accent}44, transparent)` }}
      />
    );
  }
  return (
    <span className={`rr-cover rr-cover-${shown.length >= 4 ? "quad" : "one"}`}>
      {(shown.length >= 4 ? shown : shown.slice(0, 1)).map((t) => (
        <img key={t.id} src={art(t.artwork, 120)} alt="" />
      ))}
    </span>
  );
}

export function ReplayRules({
  state,
  onReplay,
  onUnbury,
}: {
  state: AppState;
  onReplay: (container: string, allow: boolean) => void;
  onUnbury: (trackId: string) => void;
}) {
  const [showBuried, setShowBuried] = useState(false);

  const containers: Container[] = [
    { id: "liked", name: "Liked songs", tracks: state.liked, accent: "var(--save)" },
    {
      id: "discoveries",
      name: "Discoveries",
      tracks: state.discoveries,
      accent: "var(--more)",
    },
    ...state.playlists.map((p) => ({
      id: `pl:${p.id}`,
      name: p.name,
      tracks: p.tracks,
      accent: p.accent,
    })),
  ];

  const buried = state.neverTracks
    .map((id) => state.catalog.find((t) => t.id === id) ?? { id, title: null, artist: null })
    .slice(0, 50);

  return (
    <>
      <GroupLabel>what comes back</GroupLabel>
      <Note>
        Saving a song normally takes it out of the deck — you already have it.
        Switch a list back on if you treat it as a rotation rather than an
        archive. Songs you swiped left on stay gone either way.
      </Note>

      <div className="rr-list">
        {containers.map((c) => {
          const on = state.replayContainers.includes(c.id);
          return (
            <button
              key={c.id}
              className={`rr-item ${on ? "on" : ""}`}
              onClick={() => onReplay(c.id, !on)}
              aria-pressed={on}
              style={{ "--rr-accent": c.accent } as React.CSSProperties}
            >
              <Cover tracks={c.tracks} accent={c.accent} />
              <span className="rr-meta">
                <strong>{c.name}</strong>
                <small>
                  {c.tracks.length === 0
                    ? "nothing saved here yet"
                    : `${c.tracks.length} song${c.tracks.length === 1 ? "" : "s"}`}
                </small>
              </span>
              <span className="rr-state">
                <em>{on ? "comes back" : "kept out"}</em>
                <Toggle on={on} />
              </span>
            </button>
          );
        })}
      </div>

      {state.neverTracks.length > 0 && (
        <>
          <Row
            icon="✕"
            iconColor="var(--never)"
            label={`${state.neverTracks.length} buried song${state.neverTracks.length === 1 ? "" : "s"}`}
            sub="swiped left — these never come back on their own"
            right={<span className="settings-row-value">{showBuried ? "hide" : "show"}</span>}
            onClick={() => setShowBuried((v) => !v)}
          />
          {showBuried &&
            buried.map((t) => (
              <Row
                key={t.id}
                label={t.title ?? "a song no longer in the catalogue"}
                sub={t.artist ?? t.id}
                right={<span className="settings-row-value">dig out</span>}
                onClick={() => onUnbury(t.id)}
              />
            ))}
        </>
      )}
    </>
  );
}
