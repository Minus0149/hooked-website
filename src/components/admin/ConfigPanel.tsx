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
};

const GROUPS: {
  title: string;
  lede: string;
  fields: { key: keyof RuntimeConfig; label: string; hint: string; min: number; max: number }[];
}[] = [
  {
    title: "Gate & growth",
    lede: "The anonymous wall before sign-up.",
    fields: [
      { key: "gateFreeSwipes", label: "free swipes before the wall", hint: "0 shows the wall immediately", min: 0, max: 100 },
    ],
  },
  {
    title: "Hooks & ranking",
    lede: "How much evidence a hook needs before it outranks its creator's order.",
    fields: [
      { key: "hookRankMinPlays", label: "min plays to re-rank", hint: "save-rate ranking threshold", min: 1, max: 10000 },
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
    <div className="admin-v2">
      <header className="admin-head">
        <h2>Configuration</h2>
        <p>
          Product behaviour without deployments. Values are clamped server-side;
          unknown keys are ignored.
        </p>
      </header>

      {GROUPS.map((g) => (
        <section className="admin-card" key={g.title}>
          <header className="admin-card-head">
            <h3>{g.title}</h3>
            <p>{g.lede}</p>
          </header>
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

      <footer className="admin-card-foot sticky-foot">
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
        {note && <span className="config-note">{note}</span>}
      </footer>
    </div>
  );
}
