import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { deckCsv, weekOf } from "../../../convex/featureRules";
import { MOODS } from "../../data/mood";
import { deckLabel } from "../../lib/features";
import { Select, useDialogs } from "../ui/Dialogs";

/**
 * Admin → Features: the indie hook of the week (convex/featured.ts) and
 * sponsored mood decks (convex/sponsoredDecks.ts). The pick is unpaid and is
 * labelled as a pick; a deck is paid and is labelled "Sponsored" everywhere.
 */

const errorText = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught Error: /, "").split("\n")[0] : "Something went wrong";

const SHARE_URL = "https://hookedcue.com/indie-hook";

function FeaturedCard() {
  const candidates = useQuery(api.featured.candidates);
  const archive = useQuery(api.featured.archive);
  const setPick = useMutation(api.featured.setPick);
  const removePick = useMutation(api.featured.removePick);
  const { notify, confirm } = useDialogs();
  const thisWeek = weekOf(Date.now());
  const [trackId, setTrackId] = useState("");
  const [blurb, setBlurb] = useState("");
  const [week, setWeek] = useState(thisWeek);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const out = await setPick({ trackId, blurb, week });
      notify(out.emailed ? `Featured for the week of ${out.week} — artist emailed` : `Featured for the week of ${out.week}`, "success");
      setBlurb("");
    } catch (e) {
      notify(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <h3>Indie hook of the week</h3>
        <p>
          One artist upload a week, at the top of Home in both apps, labelled &ldquo;indie hook of the week&rdquo; —
          unpaid, never &ldquo;promoted&rdquo;. The artist is emailed a share link:{" "}
          <a href={SHARE_URL} target="_blank" rel="noreferrer">
            {SHARE_URL.replace("https://", "")}
          </a>{" "}
          (story image:{" "}
          <a href={`${SHARE_URL}/story`} target="_blank" rel="noreferrer">
            /indie-hook/story
          </a>
          ).
        </p>
      </header>
      <div className="admin-grid">
        <div className="field">
          <span>song (artist uploads)</span>
          <Select
            label="song to feature"
            value={trackId}
            onChange={setTrackId}
            options={[
              { value: "", label: candidates === undefined ? "loading…" : candidates.length ? "choose a song" : "no uploads yet" },
              ...(candidates ?? []).map((c) => ({ value: c.trackId, label: `${c.title} — ${c.artist}` })),
            ]}
          />
        </div>
        <label className="field">
          <span>week starting (a Monday)</span>
          <input type="date" value={week} onChange={(e) => setWeek(e.target.value)} />
        </label>
      </div>
      <label className="field promo-req-reason">
        <span>blurb — what listeners read ({blurb.length}/280)</span>
        <textarea rows={2} maxLength={280} value={blurb} onChange={(e) => setBlurb(e.target.value)} />
      </label>
      <footer className="admin-card-foot">
        <button className="aq-btn yes" disabled={busy || !trackId || blurb.trim().length < 10} onClick={() => void save()}>
          feature it and email the artist
        </button>
      </footer>
      {archive && archive.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr><th>week</th><th>song</th><th>blurb</th><th /></tr>
          </thead>
          <tbody>
            {archive.map((a) => (
              <tr key={a.week}>
                <td>{a.week}{a.week === thisWeek ? " (now)" : ""}</td>
                <td>{a.title} — {a.artist}</td>
                <td>{a.blurb}</td>
                <td>
                  <button
                    className="aq-btn no"
                    onClick={() =>
                      void confirm({ title: `Remove the pick for the week of ${a.week}?`, confirmLabel: "Remove", danger: true }).then(
                        async (ok) => {
                          if (ok) await removePick({ week: a.week });
                        },
                      )
                    }
                  >
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const day = (s: string) => new Date(`${s}T00:00:00+05:30`).getTime();

function DecksCard() {
  const decks = useQuery(api.sponsoredDecks.adminList);
  const create = useMutation(api.sponsoredDecks.create);
  const setActive = useMutation(api.sponsoredDecks.setActive);
  const { notify } = useDialogs();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ brand: "", logoUrl: "", title: "", mood: "", genre: "", trackIds: "", from: today, to: today });

  const submit = async () => {
    try {
      await create({
        brand: f.brand,
        logoUrl: f.logoUrl.trim() || undefined,
        title: f.title,
        mood: f.mood || undefined,
        genre: f.genre.trim() || undefined,
        trackIds: f.trackIds.split(",").map((s) => s.trim()).filter(Boolean),
        startsAt: day(f.from),
        endsAt: day(f.to) + 86_400_000, // through the end of the last day
        active: true,
      });
      notify("Deck created — it's live between those dates", "success");
      setF({ ...f, brand: "", logoUrl: "", title: "", trackIds: "" });
    } catch (e) {
      notify(errorText(e), "error");
    }
  };

  const download = (d: NonNullable<typeof decks>[number]) => {
    const blob = new Blob([deckCsv(d, d.days)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hookedcue-deck-${d.brand}-${d.title}.csv`.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <h3>Sponsored mood decks</h3>
        <p>
          A brand presents a deck on Home — &ldquo;Party deck · presented by Brand&rdquo;, tagged Sponsored. The sponsor
          report is counts only (impressions, opens, plays); no listener data is kept or shared.
        </p>
      </header>
      <div className="admin-grid">
        <label className="field"><span>brand</span><input maxLength={60} value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} /></label>
        <label className="field"><span>deck title</span><input maxLength={60} placeholder="Party deck" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span>logo URL (https, optional)</span><input maxLength={500} value={f.logoUrl} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} /></label>
        <div className="field">
          <span>mood</span>
          <Select
            label="deck mood"
            value={f.mood}
            onChange={(mood) => setF({ ...f, mood })}
            options={[{ value: "", label: "no mood" }, ...MOODS.map((m) => ({ value: m.id, label: m.label }))]}
          />
        </div>
        <label className="field"><span>genre (optional)</span><input maxLength={40} value={f.genre} onChange={(e) => setF({ ...f, genre: e.target.value })} /></label>
        <label className="field"><span>hand-picked song ids (comma separated, optional)</span><input value={f.trackIds} onChange={(e) => setF({ ...f, trackIds: e.target.value })} /></label>
        <label className="field"><span>from</span><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="field"><span>to (inclusive)</span><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      </div>
      <footer className="admin-card-foot">
        <button className="aq-btn yes" disabled={f.brand.trim().length < 2 || f.title.trim().length < 2} onClick={() => void submit()}>
          create deck
        </button>
      </footer>
      {decks && decks.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr><th>deck</th><th>dates</th><th>status</th><th>impressions</th><th>opens</th><th>plays</th><th /></tr>
          </thead>
          <tbody>
            {decks.map((d) => {
              const t = d.days.reduce((a, x) => ({ i: a.i + x.impressions, o: a.o + x.opens, p: a.p + x.plays }), { i: 0, o: 0, p: 0 });
              return (
                <tr key={d._id}>
                  <td>{deckLabel(d)}{d.mood ? ` · ${d.mood}` : ""}{d.genre ? ` · ${d.genre}` : ""}</td>
                  <td>{new Date(d.startsAt).toLocaleDateString("en-IN")} – {new Date(d.endsAt - 1).toLocaleDateString("en-IN")}</td>
                  <td>{d.live ? "live" : d.active ? "scheduled / ended" : "off"}</td>
                  <td>{t.i}</td>
                  <td>{t.o}</td>
                  <td>{t.p}</td>
                  <td className="deck-actions">
                    <button className="aq-btn" onClick={() => download(d)}>CSV</button>
                    <button className="aq-btn" onClick={() => void setActive({ deckId: d._id as Id<"sponsoredDecks">, active: !d.active })}>
                      {d.active ? "switch off" : "switch on"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function FeaturesPanel() {
  return (
    <>
      <FeaturedCard />
      <DecksCard />
    </>
  );
}
