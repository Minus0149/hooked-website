import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { MOODS, moodById, type MoodId } from "../../data/mood";
import { art } from "../../lib/art";
import { Face } from "../faces";
import { Cols, Empty, MediaRow, Panel, StatCard, Stats } from "../ui";

type Summary = NonNullable<ReturnType<typeof useSummaryType>>;
function useSummaryType() {
  return useQuery(api.moods.adminSummary);
}

/**
 * How the catalogue feels, according to the people who hear it.
 *
 * The mood ring writes votes; nothing read them back until now, so there was
 * no way to tell whether the feature was used, whether the floor was
 * publishing anything, or whether the analyser had measured enough of the
 * catalogue for energy to matter. This answers those three questions, in that
 * order, because that is the order they get asked in.
 */
export function MoodsPanel({ summary }: { summary: Summary }) {
  const maxVotes = Math.max(1, ...summary.byMood.map((m) => m.votes));
  const maxBand = Math.max(1, ...summary.energy.buckets);
  const coverage =
    summary.energy.total > 0 ? summary.energy.analysed / summary.energy.total : 0;

  return (
    <>
      <h2 className="admin-h2">Moods</h2>
      <p className="admin-dim">
        What listeners say songs feel like when they hold a card. A tag is only
        published to everyone once {summary.floor} separate people agree —
        below that it stays here, where one person's vote can't be read as a
        fact about a song.
      </p>

      <Stats>
        <StatCard label="mood votes" value={String(summary.votes)} sub={`from ${summary.voters} listeners`} />
        <StatCard
          label="tracks tagged"
          value={String(summary.tagged)}
          sub={`${summary.published} published`}
          color="var(--more)"
        />
        <StatCard
          label="energy measured"
          value={`${Math.round(coverage * 100)}%`}
          sub={`${summary.energy.analysed} of ${summary.energy.total} tracks`}
          color="var(--save)"
        />
      </Stats>

      <Cols>
        <Panel title="Which faces get pressed" sub="Votes per mood, and how many tracks carry each tag publicly.">
          <div className="mood-bars">
            {summary.byMood.map((m) => {
              const mood = moodById(m.mood as MoodId);
              if (!mood) return null;
              return (
                <div className="mood-bar" key={m.mood} style={{ ["--face" as string]: mood.accent }}>
                  <span className="mood-bar-face">
                    <Face mood={mood.id} size={22} />
                  </span>
                  <span className="mood-bar-name">{mood.label}</span>
                  <span className="mood-bar-track">
                    <span style={{ transform: `scaleX(${m.votes / maxVotes})` }} />
                  </span>
                  <span className="mood-bar-n">
                    {m.votes}
                    <small> · {m.tracks} tagged</small>
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel
          title="How loud the catalogue is"
          sub="Measured energy, quiet to loud — from the same audio pass that finds hooks."
        >
          {summary.energy.analysed === 0 ? (
            <Empty>
              Nothing measured yet. Run <code>node scripts/analyze-hooks.mjs</code> — energy
              is written in the same pass as hooks, at no extra cost.
            </Empty>
          ) : (
            <div className="energy-bands">
              {summary.energy.buckets.map((n, i) => (
                <div className="energy-band" key={i}>
                  <span className="energy-band-bar">
                    <span style={{ transform: `scaleY(${n / maxBand})` }} />
                  </span>
                  <small>{["quiet", "soft", "mid", "lively", "loud"][i]}</small>
                  <b>{n}</b>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </Cols>

      <Panel title="What people hear in each mood" sub="The tracks listeners tagged most, above the floor only." wide>
        {summary.published === 0 ? (
          <Empty>
            No tag has cleared the floor yet. That is the honest state of a young
            catalogue: it needs {summary.floor} people to agree about a song before
            anyone else is told.
          </Empty>
        ) : (
          <div className="mood-top">
            {summary.top
              .filter((t) => t.tracks.length > 0)
              .map((t) => {
                const mood = moodById(t.mood as MoodId);
                if (!mood) return null;
                return (
                  <div className="mood-top-col" key={t.mood} style={{ ["--face" as string]: mood.accent }}>
                    <h4>
                      <Face mood={mood.id} size={18} /> {mood.label}
                    </h4>
                    {t.tracks.map((tr) => (
                      <MediaRow
                        key={tr.trackId}
                        artwork={tr.artwork ? art(tr.artwork, 100) : undefined}
                        title={tr.title}
                        sub={tr.artist}
                        right={<span className="mood-top-n">{tr.n}</span>}
                      />
                    ))}
                  </div>
                );
              })}
          </div>
        )}
      </Panel>

      <p className="admin-dim" style={{ marginTop: 12 }}>
        The six faces, loudest first: {MOODS.map((m) => m.label.toLowerCase()).join(" · ")}.
        How hard a mood pulls on the deck, and the publishing floor, live under Config.
      </p>
    </>
  );
}
