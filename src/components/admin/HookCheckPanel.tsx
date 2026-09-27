import { useCallback, useEffect, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { art } from "../../lib/art";
import { Empty, Panel, StatCard, Stats } from "../ui";
import { Select, useDialogs } from "../ui/Dialogs";

/**
 * Admin → Hook check: does hook recognition find the hook a person hears?
 *
 * Blind first: the page hides every machine pick until you have marked where
 * YOU hear the hook start, so the marks measure the detector instead of
 * agreeing with it. Then it shows the app's hook for a good/bad verdict.
 * convex/hookCheck.ts keeps the labels and scores each method against them.
 */

type Song = FunctionReturnType<typeof api.hookCheck.sample>[number];
type Health = FunctionReturnType<typeof api.hookPlans.status>;

const POLICIES = [
  { value: "0", label: "Whole preview from 0" },
  { value: "1", label: "Heuristic (loudness lift)" },
  { value: "2", label: "Auto (model when confident)" },
];
const POLICY_NUM: Record<string, number> = { preview: 0, heuristic: 1, auto: 2 };
const METHOD_LABEL = {
  auto: "Auto — model when confident, else 0",
  model: "Model, always",
  modelWhenConfident: "Model, confident songs only",
  heuristic: "Heuristic",
  preview: "Preview from 0",
  current: "What the app plays now",
} as const;

const errorText = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught Error: /, "").split("\n")[0] : "Something went wrong";
const secs = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);

function Scrubber({ song, total, now, reveal, onSeek }: {
  song: Song;
  total: number;
  now: number;
  reveal: boolean;
  onSeek: (ms: number) => void;
}) {
  const at = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`;
  const span = (a: number, b: number) => ({ left: at(a), width: `calc(${at(b)} - ${at(a)})` });
  const mark = song.label?.markedStartMs;
  return (
    <div
      className="hc-scrub"
      role="slider"
      tabIndex={-1}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(total / 1000)}
      aria-valuenow={Math.round(now / 1000)}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - r.left) / r.width) * total);
      }}
    >
      {reveal &&
        song.analysis?.sections.map((s, i) => (
          <span
            key={`s${i}`}
            className={`hc-sec l${s.label % 6}`}
            style={span(s.startMs, s.endMs)}
            title={`section ${String.fromCharCode(65 + s.label)} · score ${s.score.toFixed(2)}`}
          />
        ))}
      {reveal &&
        song.hooks.map((h, i) => (
          <span
            key={`h${i}`}
            className="hc-hook"
            style={span(h.startMs, h.startMs + h.durationMs)}
            title={`app hook ${i + 1}: ${secs(h.startMs)} for ${secs(h.durationMs)} (${h.method})`}
          />
        ))}
      <span className="hc-fill" style={{ width: at(now) }} />
      {reveal && song.analysis?.modelStartMs != null && (
        <span className="hc-pin model" style={{ left: at(song.analysis.modelStartMs) }} title="model">M</span>
      )}
      {reveal && song.analysis && (
        <span className="hc-pin heur" style={{ left: at(song.analysis.heuristicStartMs) }} title="heuristic">H</span>
      )}
      {mark != null && (
        <span className="hc-pin you" style={{ left: at(mark) }} title="your mark">▼</span>
      )}
    </div>
  );
}

export function HookCheckPanel() {
  const songs = useQuery(api.hookCheck.sample);
  const results = useQuery(api.hookCheck.evaluate);
  const config = useQuery(api.runtime.get) as { hookPolicy?: number } | null | undefined;
  const label = useMutation(api.hookCheck.label);
  const draw = useMutation(api.hookCheck.drawSample);
  const setRuntime = useMutation(api.runtime.set);
  const applyPolicy = useMutation(api.hookPlans.applyPolicy);
  const convex = useConvex();
  const { notify, confirm } = useDialogs();

  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(0);
  const [total, setTotal] = useState(30_000);
  const [playing, setPlaying] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [policy, setPolicy] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number | null>(null);

  const song: Song | undefined = songs?.[Math.min(index, Math.max(0, songs.length - 1))];
  const reveal = song?.label?.markedStartMs != null;

  // follow the audio clock; stop at the end of the hook when playing one
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a) {
        setNow(a.currentTime * 1000);
        if (stopAt.current !== null && a.currentTime * 1000 >= stopAt.current) {
          a.pause();
          stopAt.current = null;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    stopAt.current = null;
    setNow(0);
    setTotal(song?.analysis?.durationMs || 30_000);
  }, [song?.trackId, song?.analysis?.durationMs]);

  const save = useCallback(
    async (patch: { markedStartMs?: number | null; verdict?: "good" | "bad" | null }) => {
      if (!song) return;
      try {
        await label({ trackId: song.trackId, ...patch });
      } catch (e) {
        notify(errorText(e), "error");
      }
    },
    [label, notify, song],
  );

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    stopAt.current = null;
    if (a.paused) void a.play().catch(() => notify("This preview would not play", "error"));
    else a.pause();
  }, [notify]);

  const markHere = useCallback(() => {
    const a = audioRef.current;
    if (a) void save({ markedStartMs: Math.round(a.currentTime * 1000) });
  }, [save]);

  const nudge = useCallback(
    (ms: number) => {
      const m = song?.label?.markedStartMs;
      if (m == null) return;
      const next = Math.max(0, m + ms);
      void save({ markedStartMs: next });
      const a = audioRef.current;
      if (a) {
        a.currentTime = next / 1000;
        stopAt.current = null;
        void a.play().catch(() => undefined);
      }
    },
    [save, song],
  );

  const playHook = useCallback(() => {
    const a = audioRef.current;
    const h = song?.hooks[0];
    if (!a || !h) return;
    a.currentTime = h.startMs / 1000;
    stopAt.current = h.startMs + h.durationMs;
    void a.play().catch(() => notify("This preview would not play", "error"));
  }, [notify, song]);

  const go = useCallback(
    (d: number) => {
      audioRef.current?.pause();
      setIndex((i) => Math.min(Math.max(0, i + d), Math.max(0, (songs?.length ?? 1) - 1)));
    },
    [songs?.length],
  );

  // keyboard: Space play · M mark · ←/→ nudge the mark · H play the app's hook
  // · G good · B bad · N / Enter next · P previous
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (t?.closest(".sel") || t?.closest("[role=dialog]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === " ") toggle();
      else if (k === "m") markHere();
      else if (k === "arrowleft") nudge(-250);
      else if (k === "arrowright") nudge(250);
      else if (k === "h" && reveal) playHook();
      else if (k === "g" && reveal) void save({ verdict: "good" });
      else if (k === "b" && reveal) void save({ verdict: "bad" });
      else if (k === "n" || k === "enter") go(1);
      else if (k === "p") go(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, markHere, nudge, playHook, reveal, save, toggle]);

  const measure = async () => {
    setMeasuring(true);
    try {
      setHealth(await convex.query(api.hookPlans.status, {}));
    } catch (e) {
      notify(errorText(e), "error");
    } finally {
      setMeasuring(false);
    }
  };

  const drawMore = () =>
    void draw({}).then(
      (r) => notify(r.added > 0 ? `${r.added} songs drawn` : "No more analysed songs to draw", "success"),
      (e) => notify(errorText(e), "error"),
    );

  const currentPolicy = String(config?.hookPolicy ?? 2);
  const chosen = policy ?? currentPolicy;
  const policyName = (value: string) => POLICIES.find((p) => p.value === value)?.label ?? value;
  const apply = async (value: string) => {
    const ok = await confirm({
      title: `Re-plan every song's hooks as “${policyName(value)}”?`,
      body: "Every analysed song has its machine-made hooks replaced in the background. A creator's own marks are never touched, and nothing is downloaded again — you can switch back any time.",
      confirmLabel: "Apply to all songs",
    });
    if (!ok) return;
    try {
      await setRuntime({ hookPolicy: Number(value) });
      await applyPolicy({});
      setPolicy(null);
      notify(`Applying “${policyName(value)}” to every song`, "success");
    } catch (e) {
      notify(errorText(e), "error");
    }
  };

  if (songs === undefined || results === undefined) return <p className="admin-empty">Loading…</p>;

  const marked = songs.filter((s) => s.label?.markedStartMs != null).length;
  const rated = songs.filter((s) => s.label?.verdict).length;
  const rec = results.recommendation;
  const recValue = rec.policy ? String(POLICY_NUM[rec.policy]) : null;

  return (
    <>
      <h2 className="admin-h2">Hook check</h2>
      <p className="admin-dim">
        Does the app start each song where a person hears the hook? Listen, mark, rate. The
        machine's picks stay hidden until you've marked a song, so your marks test it instead of
        agreeing with it.
      </p>

      <Stats>
        <StatCard label="songs marked" value={`${marked}/${songs.length}`} sub={`${rated} rated good or bad`} />
        <StatCard label="playing now" value={policyName(currentPolicy).split(" (")[0]} sub="hook policy" color="var(--more)" />
        <StatCard
          label="the labels say"
          value={recValue ? policyName(recValue).split(" (")[0] : "not yet"}
          sub={rec.reason}
          color="var(--save)"
        />
      </Stats>

      {songs.length === 0 || !song ? (
        <Panel title="No sample yet">
          <Empty>
            Draw 30 songs the analyser has heard. If nothing comes back, the analyser hasn't run yet
            (<code>scripts/analyze-hooks-v3.py</code>).
          </Empty>
          <button className="aq-btn yes" onClick={drawMore}>draw 30 songs</button>
        </Panel>
      ) : (
        <Panel
          wide
          title={`Song ${Math.min(index, songs.length - 1) + 1} of ${songs.length}`}
          sub="Space play · M mark the hook start · ←/→ nudge the mark · H play the app's hook · G good · B bad · N next"
          actions={
            <>
              <button className="aq-btn" onClick={() => go(-1)} disabled={index === 0}>previous</button>
              <button className="aq-btn yes" onClick={() => go(1)} disabled={index >= songs.length - 1}>next</button>
            </>
          }
        >
          <div className="hc-dots" aria-label="Progress">
            {songs.map((s, i) => (
              <button
                key={s.trackId}
                className={`hc-dot${i === index ? " on" : ""}${s.label?.markedStartMs != null ? " marked" : ""}${s.label?.verdict ? ` ${s.label.verdict}` : ""}`}
                onClick={() => {
                  audioRef.current?.pause();
                  setIndex(i);
                }}
                aria-label={`Song ${i + 1}${s.label?.markedStartMs != null ? ", marked" : ""}`}
              />
            ))}
          </div>
          <div className="hc-song">
            {song.artwork && <img src={art(song.artwork, 200)} alt="" />}
            <div>
              <strong>{song.title}</strong>
              <span>{song.artist}</span>
            </div>
            <span className="hc-time">{secs(now)}</span>
          </div>
          {song.url ? (
            <audio
              key={song.trackId}
              ref={audioRef}
              src={song.url}
              preload="auto"
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                if (Number.isFinite(d) && d > 0) setTotal(d * 1000);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          ) : (
            <Empty>This song has no playable audio.</Empty>
          )}
          <Scrubber
            song={song}
            total={total}
            now={now}
            reveal={reveal}
            onSeek={(ms) => {
              const a = audioRef.current;
              if (!a) return;
              stopAt.current = null;
              a.currentTime = ms / 1000;
            }}
          />
          <div className="hc-actions">
            <button className="aq-btn" onClick={toggle}>{playing ? "pause" : "play"}</button>
            <button className="aq-btn yes" onClick={markHere}>mark hook start here</button>
            {reveal && (
              <button className="aq-btn" onClick={() => void save({ markedStartMs: null, verdict: null })}>clear</button>
            )}
          </div>
          {reveal ? (
            <div className="hc-reveal">
              <p className="admin-dim">
                You marked <b>{secs(song.label?.markedStartMs)}</b>. The model picked{" "}
                <b>{secs(song.analysis?.modelStartMs)}</b>
                {song.analysis ? ` (confidence ${song.analysis.confidence.toFixed(2)})` : ""}, the heuristic{" "}
                <b>{secs(song.analysis?.heuristicStartMs)}</b>. The app plays{" "}
                {song.hooks.length === 0
                  ? "no hook"
                  : song.hooks.map((h) => `${secs(h.startMs)} → ${secs(h.startMs + h.durationMs)}`).join(", ")}{" "}
                ({song.hooks[0]?.method ?? "—"}).
              </p>
              <div className="hc-actions">
                <button className="aq-btn" onClick={playHook} disabled={song.hooks.length === 0}>play the app's hook</button>
                <button
                  className={`aq-btn yes${song.label?.verdict === "good" ? " picked" : ""}`}
                  onClick={() => void save({ verdict: "good" })}
                  aria-pressed={song.label?.verdict === "good"}
                >
                  good hook
                </button>
                <button
                  className={`aq-btn no${song.label?.verdict === "bad" ? " picked" : ""}`}
                  onClick={() => void save({ verdict: "bad" })}
                  aria-pressed={song.label?.verdict === "bad"}
                >
                  bad hook
                </button>
              </div>
            </div>
          ) : (
            <p className="admin-dim">
              Play from the start. When the part you'd sing along to begins (chorus, drop, the main
              riff) press <b>M</b> on its first beat. If the preview opens on the hook, mark 0.
            </p>
          )}
        </Panel>
      )}

      <Panel
        wide
        title="How each method does against your marks"
        sub={`${results.marked} marked songs. Mean error is how far a method's start is from your mark; within 2 s is how often it lands on it.`}
        actions={songs.length > 0 ? <button className="aq-btn" onClick={drawMore}>draw 30 more</button> : undefined}
      >
        <table className="hc-table">
          <thead>
            <tr>
              <th>method</th>
              <th>songs</th>
              <th>mean error</th>
              <th>within 2 s</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(METHOD_LABEL) as (keyof typeof METHOD_LABEL)[]).map((k) => (
              <tr key={k}>
                <td>{METHOD_LABEL[k]}</td>
                <td>{results.scores[k].n}</td>
                <td>{results.scores[k].meanAbsErrorS == null ? "—" : `${results.scores[k].meanAbsErrorS} s`}</td>
                <td>{results.scores[k].within2s == null ? "—" : `${results.scores[k].within2s} %`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {Object.keys(results.verdicts).length > 0 && (
          <p className="admin-dim" style={{ marginTop: 10 }}>
            Verdicts on the hook the app played:{" "}
            {Object.entries(results.verdicts)
              .map(([m, v]) => `${m} ${v.good} good / ${v.bad} bad`)
              .join(" · ")}
          </p>
        )}
        <div className="hc-actions" style={{ marginTop: 12 }}>
          <Select label="Hook policy" value={chosen} options={POLICIES} onChange={(v) => setPolicy(v)} />
          <button className="aq-btn yes" onClick={() => void apply(chosen)}>apply to all songs</button>
          {recValue && recValue !== currentPolicy && (
            <button className="aq-btn" onClick={() => void apply(recValue)}>use what the labels say</button>
          )}
        </div>
      </Panel>

      <Panel
        wide
        title="Catalogue hook health"
        sub="Reads every hook, so it runs when you ask. The target is 0 % repeated seconds and nothing under 15 s."
        actions={
          <button className="aq-btn" onClick={() => void measure()} disabled={measuring}>
            {measuring ? "measuring…" : "measure"}
          </button>
        }
      >
        {health ? (
          <div className="hc-health">
            <p>
              <b>{health.tracks}</b> songs with hooks · <b>{health.tracksHeard}</b> heard by v3 ·{" "}
              <b>{health.tracksWaiting}</b> waiting
            </p>
            <p>
              Hook length: median <b>{health.lengthS.median} s</b> (p10 {health.lengthS.p10} s, p90{" "}
              {health.lengthS.p90} s, min {health.lengthS.min} s) · under 15 s: <b>{health.shorterThan15s} %</b>
            </p>
            <p>
              Songs replaying the same seconds: <b>{health.repeatedSecondsPct} %</b> · hooks per song:{" "}
              {Object.entries(health.hooksPerTrack).map(([k, n]) => `${k}: ${n}`).join(", ")}
            </p>
            <p>
              Made by:{" "}
              {Object.entries(health.methods)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => `${k} ${n}`)
                .join(" · ")}
            </p>
          </div>
        ) : (
          <Empty>Press measure.</Empty>
        )}
      </Panel>
    </>
  );
}
