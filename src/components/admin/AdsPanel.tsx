import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * The ads studio: pacing rules on the left, campaigns on the right.
 *
 * The cadence presets exist because "1 per day" and "every 10 minutes" are how
 * humans describe ad load â€” the numbers underneath are an implementation
 * detail the panel happily accepts too (custom mode).
 */

type AdRow = {
  _id: Id<"ads">;
  advertiser: string;
  title: string;
  body?: string;
  ctaLabel: string;
  ctaUrl: string;
  imageUrl: string | null;
  accent?: string;
  weight: number;
  status: "draft" | "live" | "retired";
  updatedAt: string;
};

type AdsConfig = {
  enabled: boolean;
  everyNSwipes: number;
  cooldownMinutes: number;
  maxPerDay: number;
  maxPerWeek: number;
};

const PRESETS = [
  { id: "daily", label: "One per day", cfg: { enabled: true, everyNSwipes: 12, cooldownMinutes: 60, maxPerDay: 1, maxPerWeek: 7 } },
  { id: "steady", label: "Every 10 minutes", cfg: { enabled: true, everyNSwipes: 12, cooldownMinutes: 10, maxPerDay: 6, maxPerWeek: 30 } },
  { id: "twice", label: "Twice a day", cfg: { enabled: true, everyNSwipes: 15, cooldownMinutes: 120, maxPerDay: 2, maxPerWeek: 14 } },
  { id: "off", label: "No ads", cfg: { enabled: false, everyNSwipes: 12, cooldownMinutes: 10, maxPerDay: 3, maxPerWeek: 15 } },
] as const;

function presetIdFor(cfg: AdsConfig): string {
  const hit = PRESETS.find((p) =>
    p.cfg.enabled === cfg.enabled &&
    p.cfg.maxPerDay === cfg.maxPerDay &&
    p.cfg.cooldownMinutes === cfg.cooldownMinutes &&
    p.cfg.maxPerWeek === cfg.maxPerWeek,
  );
  return hit?.id ?? "custom";
}

function CadenceCard({ config }: { config: AdsConfig }) {
  const setConfig = useMutation(api.ads.setConfig);
  const [draft, setDraft] = useState<AdsConfig>(config);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // keep the draft in sync when someone else (another admin tab) saves
  const [preset, setPreset] = useState(presetIdFor(config));

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    setDraft({ ...p.cfg });
    setDirty(true);
  };
  const edit = (patch: Partial<AdsConfig>) => {
    setPreset("custom");
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      await setConfig({ ...draft });
      setDirty(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <h3>Pacing</h3>
        <p>How often a sponsored card may appear. Changes push live to every open deck.</p>
      </header>
      <div className="admin-grid">
        <div className="pill-row">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`pill ${preset === p.id ? "on" : ""}`}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
          <span className={`pill ${preset === "custom" ? "on" : ""}`}>Custom</span>
        </div>

        <label className="field">
          <span>swipes between cards</span>
          <input
            type="number" min={3} max={200} value={draft.everyNSwipes}
            onChange={(e) => edit({ everyNSwipes: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>cooldown (minutes)</span>
          <input
            type="number" min={0} max={1440} value={draft.cooldownMinutes}
            onChange={(e) => edit({ cooldownMinutes: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>max per listener per day</span>
          <input
            type="number" min={0} max={50} value={draft.maxPerDay}
            onChange={(e) => edit({ maxPerDay: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>max per listener per week</span>
          <input
            type="number" min={0} max={200} value={draft.maxPerWeek}
            onChange={(e) => edit({ maxPerWeek: Number(e.target.value) })}
          />
          <small className="field-hint">floored at the daily cap server-side</small>
        </label>
        <label className="check-field">
          <input
            type="checkbox" checked={draft.enabled}
            onChange={(e) => edit({ enabled: e.target.checked })}
          />
          <span>ads enabled</span>
        </label>
      </div>
      <footer className="admin-card-foot">
        <button className="aq-btn yes" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "pushingâ€¦" : dirty ? "Push live" : "Live"}
        </button>
      </footer>
    </section>
  );
}

const EMPTY_FORM = {
  advertiser: "",
  title: "",
  body: "",
  ctaLabel: "Learn more",
  ctaUrl: "",
  weight: 3,
  status: "draft" as AdRow["status"],
};

function CampaignEditor({
  existing,
  onDone,
}: {
  existing?: AdRow;
  onDone: () => void;
}) {
  const saveAd = useMutation(api.ads.saveAd);
  const uploadUrl = useMutation(api.ads.generateAdUploadUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(
    existing
      ? {
          advertiser: existing.advertiser,
          title: existing.title,
          body: existing.body ?? "",
          ctaLabel: existing.ctaLabel,
          ctaUrl: existing.ctaUrl,
          weight: existing.weight,
          status: existing.status,
        }
      : { ...EMPTY_FORM },
  );
  const [imageId, setImageId] = useState<Id<"_storage"> | null>(existing ? null : null);
  const [imageUrl, setImageUrl] = useState<string | null>(existing?.imageUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const url = await uploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      setImageId(storageId);
      setImageUrl(URL.createObjectURL(file));
    } catch {
      setError("Image upload failed");
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveAd({
        id: existing?._id,
        advertiser: form.advertiser,
        title: form.title,
        body: form.body || undefined,
        ctaLabel: form.ctaLabel,
        ctaUrl: form.ctaUrl,
        imageStorageId: imageId ?? undefined,
        weight: form.weight,
        status: form.status,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <h3>{existing ? `Edit â€” ${existing.advertiser}` : "New campaign"}</h3>
        <p>The card listeners see between swipes. One clear offer works best.</p>
      </header>
      <div className="admin-grid">
        <label className="field">
          <span>advertiser</span>
          <input value={form.advertiser} maxLength={40} placeholder="Acme Coffee"
            onChange={(e) => setForm({ ...form, advertiser: e.target.value })} />
        </label>
        <label className="field">
          <span>headline</span>
          <input value={form.title} maxLength={80} placeholder="Fuel your next session"
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <label className="field field-wide">
          <span>body</span>
          <textarea rows={2} value={form.body} maxLength={160}
            onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </label>
        <label className="field">
          <span>button text</span>
          <input value={form.ctaLabel} maxLength={24}
            onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })} />
        </label>
        <label className="field">
          <span>link (https)</span>
          <input value={form.ctaUrl} placeholder="https://â€¦" 
            onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })} />
        </label>
        <label className="field">
          <span>weight (share of impressions)</span>
          <input type="number" min={1} max={20} value={form.weight}
            onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>status</span>
          <select value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as AdRow["status"] })}>
            <option value="draft">draft</option>
            <option value="live">live</option>
            <option value="retired">retired</option>
          </select>
        </label>
        <div className="field">
          <span>artwork</span>
          <div className="art-row">
            {imageUrl && <img src={imageUrl} alt="" width={44} height={44} />}
            <button type="button" className="aq-btn" onClick={() => fileRef.current?.click()}>
              {imageId || imageUrl ? "replace" : "upload"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onImage} />
          </div>
        </div>
      </div>
      {error && <p className="access-error">{error}</p>}
      <footer className="admin-card-foot">
        <button className="aq-btn yes" disabled={busy} onClick={() => void save()}>
          {busy ? "savingâ€¦" : "save campaign"}
        </button>
        <button className="aq-btn" onClick={onDone}>cancel</button>
      </footer>
    </section>
  );
}

export function AdsPanel() {
  const ads = useQuery(api.ads.listAds) as AdRow[] | null | undefined;
  const config = useQuery(api.ads.getConfig) as AdsConfig | null | undefined;
  const [editing, setEditing] = useState<AdRow | "new" | null>(null);

  return (
    <div className="admin-v2">
      <header className="admin-head">
        <h2>Ads</h2>
        <p>
          First-party house cards only â€” no SDKs, no third-party tags. Pacing is
          enforced server-side; the deck paces by swipes.
        </p>
      </header>

      {editing === "new" ? (
        <CampaignEditor onDone={() => setEditing(null)} />
      ) : editing ? (
        <CampaignEditor existing={editing} onDone={() => setEditing(null)} />
      ) : (
        <>
          <CadenceCard config={config ?? { enabled: true, everyNSwipes: 12, cooldownMinutes: 10, maxPerDay: 3, maxPerWeek: 15 }} />

          <section className="admin-card">
            <header className="admin-card-head row">
              <div>
                <h3>Campaigns</h3>
                <p>Drafts don't serve; retired ones keep their stats.</p>
              </div>
              <button className="aq-btn yes" onClick={() => setEditing("new")}>
                + new campaign
              </button>
            </header>
            {(ads ?? []).length === 0 && (
              <p className="admin-empty">No campaigns yet.</p>
            )}
            <ul className="campaign-list">
              {(ads ?? []).map((ad) => (
                <li key={ad._id} className="campaign-row">
                  {ad.imageUrl ? (
                    <img src={ad.imageUrl} alt="" className="campaign-art" />
                  ) : (
                    <span className="campaign-art campaign-art-blank" style={{ background: ad.accent }} />
                  )}
                  <div className="campaign-meta">
                    <strong>{ad.advertiser}</strong>
                    <span>{ad.title}</span>
                    <small>{ad.ctaLabel} â†’ {ad.ctaUrl}</small>
                  </div>
                  <span className={`aq-tag ${ad.status === "live" ? "approved" : ad.status === "draft" ? "pending" : ""}`}>
                    {ad.status}
                  </span>
                  <span className="campaign-weight">w{ad.weight}</span>
                  <button className="aq-btn" onClick={() => setEditing(ad)}>edit</button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

