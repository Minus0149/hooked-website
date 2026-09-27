import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

/**
 * Live runtime config.
 *
 * Every value here is read reactively by the clients through
 * api.runtime.get — saving doesn't deploy anything, it just… happens,
 * everywhere, on the next render. The panel groups the knobs the way you
 * think about them, not the way they're stored (one row in appSettings).
 */

type RuntimeConfig = {
  gateFreeSwipes: number;
  importStaleMinutes: number;
  hookRankMinPlays: number;
  bestHookMinPlays: number;
  sessionGapMinutes: number;
  analyticsSpanDays: number;
  recsStrength: number;
  recsMinRaters: number;
  recsMinSupport: number;
  chartFeedsPerRun: number;
  catalogRebuildHours: number;
  minAndroidVersionCode: number;
  indiaSharePct: number;
  pickedLangPct: number;
  artistCap: number;
  staleWeeks: number;
  maxAgeYears: number;
  oldChartDays: number;
  moodStrength: number;
  moodMinVotes: number;
  modelStrength: number;
  referralCap: number;
  hookPolicy: number;
};

const GROUPS: {
  title: string;
  lede: string;
  fields: { key: keyof RuntimeConfig; label: string; hint: string; min: number; max: number }[];
}[] = [
  {
    title: "Gate & growth",
    lede: "The anonymous wall before sign-up, and invite links.",
    fields: [
      { key: "gateFreeSwipes", label: "free swipes before the wall", hint: "0 shows the wall immediately", min: 0, max: 100 },
      { key: "referralCap", label: "friends each invite link approves", hint: "they skip the waitlist; past this they queue as normal. 0 turns invite links off", min: 0, max: 50 },
    ],
  },
  {
    title: "Hooks & ranking",
    lede: "How much evidence a hook needs before it outranks its creator's order.",
    fields: [
      { key: "hookRankMinPlays", label: "min plays to re-rank", hint: "save-rate ranking threshold", min: 1, max: 10000 },
      { key: "hookPolicy", label: "hook start: 0 preview · 1 heuristic · 2 auto", hint: "auto = the structure model when confident, else the whole preview. Saving changes new analyses; \"apply to all songs\" in Hook check re-plans the rest", min: 0, max: 2 },
    ],
  },
  {
    title: "Recommendations",
    lede: "\"People who reacted to this reacted to that\", learned from the swipe log. The two floors are a privacy setting as much as a quality one — nothing is published until several separate listeners have linked a pair.",
    fields: [
      { key: "recsStrength", label: "how hard it pulls", hint: "places a song may jump; 0 switches the recommender off", min: 0, max: 40 },
      { key: "recsMinRaters", label: "min listeners per track", hint: "before a track can be modelled at all", min: 2, max: 50 },
      { key: "recsMinSupport", label: "min listeners per pair", hint: "before a link between two songs is published", min: 1, max: 50 },
    ],
  },
  {
    title: "Moods & the local model",
    lede: "The two signals that work with no backend at all — a face someone pressed, and the model each device trains on its own listener's swipes. Both are client-side, so a change here reaches a deck the next time it loads the config; both default to on, because they work offline and for a signed-out guest.",
    fields: [
      { key: "moodStrength", label: "how hard a mood pulls", hint: "places a matching song may jump; 0 makes the faces decoration", min: 0, max: 40 },
      { key: "moodMinVotes", label: "min listeners per mood tag", hint: "before \"this song feels like that\" is published to everyone", min: 1, max: 50 },
      { key: "modelStrength", label: "how hard the local model pulls", hint: "its ceiling once there is evidence; it damps itself before that", min: 0, max: 40 },
    ],
  },
  {
    title: "Analytics",
    lede: "Windows for the nightly snapshot and the live ticker.",
    fields: [
      { key: "sessionGapMinutes", label: "session gap", hint: "a swipe pause longer than this starts a new session", min: 5, max: 720 },
      { key: "bestHookMinPlays", label: "best/worst hooks min plays", hint: "evidence floor for the panels", min: 1, max: 10000 },
      { key: "analyticsSpanDays", label: "snapshot span (days)", hint: "7–90; nightly job uses this", min: 7, max: 90 },
    ],
  },
  {
    title: "Catalogue",
    lede: "What the deck is made of. Each night pulls the next few of 32 Apple chart feeds (India's own genre charts first, then the Western headline charts), and a daily curation pass hides filler, covers, sped-up versions, one artist flooding the deck, and songs that have left every chart. Curation only hides — an admin un-hide sticks, and saved songs stay in libraries. New songs arrive with provisional hooks until their audio is analysed.",
    fields: [
      { key: "chartFeedsPerRun", label: "chart feeds per night", hint: "of 32; 0 stops the job entirely", min: 0, max: 100 },
      { key: "catalogRebuildHours", label: "catalogue rebuild every (hours)", hint: "background changes wait this long; admin hides publish within a minute", min: 0.25, max: 48 },
      { key: "indiaSharePct", label: "Indian share of the deck (%)", hint: "for listeners who picked no language; 0 leaves it to the shuffle", min: 0, max: 100 },
      { key: "pickedLangPct", label: "picked-language share (%)", hint: "for listeners who picked languages; the rest is discovery. 0 turns it off", min: 0, max: 100 },
      { key: "artistCap", label: "songs per artist", hint: "curation keeps each artist's strongest few", min: 1, max: 50 },
      { key: "staleWeeks", label: "off the charts for (weeks)", hint: "then it stops being dealt", min: 1, max: 520 },
      { key: "maxAgeYears", label: "back-catalogue cutoff (years)", hint: "older songs are dealt only while charting", min: 1, max: 100 },
      { key: "oldChartDays", label: "\"charting\" means within (days)", hint: "for those older songs; a full sweep takes two nights", min: 1, max: 365 },
    ],
  },
  {
    title: "App updates",
    lede: "Screen and code changes reach phones over the air on their own. A new build on Google Play is offered in the app as a banner; set a minimum here to make a build required — phones below it can't continue until they update.",
    fields: [
      { key: "minAndroidVersionCode", label: "oldest Android build allowed", hint: "a versionCode, e.g. 5; 0 never forces an update", min: 0, max: 100000 },
    ],
  },
  {
    title: "Imports",
    lede: "When a browser import run is declared dead.",
    fields: [
      { key: "importStaleMinutes", label: "stale after (minutes)", hint: "matching runs older than this get failed by cron", min: 5, max: 1440 },
    ],
  },
];

export function ConfigPanel() {
  const config = useQuery(api.runtime.get) as RuntimeConfig | null | undefined;
  const setRuntime = useMutation(api.runtime.set);
  const refreshAnalytics = useMutation(api.admin.refreshAnalytics);
  const rebuildRecs = useMutation(api.recommend.refresh);
  const pullCharts = useMutation(api.charts.refreshNow);
  const curateNow = useMutation(api.curation.runNow);
  const [draft, setDraft] = useState<Partial<RuntimeConfig>>({});
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // follow external changes unless the admin is mid-edit
  const dirty = Object.keys(draft).length > 0;
  useEffect(() => {
    if (!dirty && config) setDraft({});
  }, [config, dirty]);

  if (config === undefined) {
    return <p className="admin-empty">Loading…</p>;
  }

  const valueFor = (key: keyof RuntimeConfig) =>
    draft[key] ?? config?.[key] ?? 0;

  const saveAll = async () => {
    setSaving(true);
    setNote(null);
    try {
      await setRuntime(draft);
      setDraft({});
      setNote("Pushed live — every open client picks it up on its next render.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-page">
      <header className="admin-head">
        <h2>Configuration</h2>
        <p>
          Product behaviour without deployments. Values are clamped server-side;
          unknown keys are ignored.
        </p>
      </header>

      {GROUPS.map((g) => (
        <section className="admin-panel config-group" key={g.title}>
          <h3>{g.title}</h3>
          <p className="admin-dim">{g.lede}</p>
          <div className="admin-grid">
            {g.fields.map((f) => (
              <label className="field" key={f.key}>
                <span>{f.label}</span>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  value={valueFor(f.key)}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))
                  }
                />
                <small className="field-hint">{f.hint} · currently {config?.[f.key]}</small>
              </label>
            ))}
          </div>
        </section>
      ))}

      <footer className="config-foot">
        <button
          className="aq-btn yes"
          disabled={!dirty || saving}
          onClick={() => void saveAll()}
        >
          {saving ? "pushing…" : dirty ? `Push ${Object.keys(draft).length} change${Object.keys(draft).length === 1 ? "" : "s"} live` : "Nothing to push"}
        </button>
        <button
          className="aq-btn"
          disabled={saving}
          onClick={() => {
            void refreshAnalytics()
              .then(() => setNote("Analytics snapshot recomputed."))
              .catch((e: Error) => setNote(e.message));
          }}
        >
          Recompute analytics now
        </button>
        <button
          className="aq-btn"
          disabled={saving}
          onClick={() => {
            void rebuildRecs()
              .then((r) =>
                setNote(
                  r
                    ? `Model rebuilt from ${r.read} swipes: ${r.rated} tracks had enough listeners, ${r.linked} ended up linked.`
                    : "Not permitted.",
                ),
              )
              .catch((e: Error) => setNote(e.message));
          }}
        >
          Rebuild recommendations now
        </button>
        <button
          className="aq-btn"
          disabled={saving}
          onClick={() => {
            void pullCharts({})
              .then(() =>
                setNote(
                  "Pulling the next few chart feeds — new songs appear in the catalogue as they land.",
                ),
              )
              .catch((e: Error) => setNote(e.message));
          }}
        >
          Pull from the charts now
        </button>
        <button
          className="aq-btn"
          disabled={saving}
          onClick={() => {
            void curateNow()
              .then(() => setNote("Curating — the deck's catalogue updates in a minute or two."))
              .catch((e: Error) => setNote(e.message));
          }}
        >
          Curate the catalogue now
        </button>
        {note && <span className="config-note">{note}</span>}
      </footer>
    </div>
  );
}
