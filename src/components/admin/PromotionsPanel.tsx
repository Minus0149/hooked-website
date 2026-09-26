import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Select, useDialogs } from "../ui/Dialogs";

/**
 * Paid promotion, run from here (convex/promotions.ts, docs/PROMOTIONS.md):
 * packages and pacing, the launch offer, capacity, one artist's personal
 * rate, discount codes, and what has been sold. Every number is re-checked by
 * the server; this form can't set a price the server wouldn't.
 */

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const toPaise = (rupeesText: string) => Math.round(Number(rupeesText) * 100);

type Pkg = { id: string; name: string; listeners: number; pricePaise: number };
type Config = {
  enabled: boolean;
  packages: Pkg[];
  launchOffer: { enabled: boolean; percentOff: number };
  everyNCards: number;
  perListenerDaily: number;
  windowDays: number;
  capacityListeners: number;
};

export function PromotionsPanel() {
  const data = useQuery(api.promotions.adminOverview);
  if (data === undefined) return <p className="admin-empty">Loading…</p>;
  return (
    <>
      <Summary data={data} />
      <ConfigCard key={JSON.stringify(data.config)} config={data.config as Config} />
      <RatesCard artists={data.artists} rates={data.rates} />
      <CodesCard artists={data.artists} codes={data.codes} />
      <CampaignsCard data={data} />
    </>
  );
}

type Overview = NonNullable<ReturnType<typeof useQuery<typeof api.promotions.adminOverview>>>;

function Summary({ data }: { data: Overview }) {
  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <h3>Promotion</h3>
        <p>
          {data.paymentsConfigured ? "Razorpay keys are set." : "Razorpay keys are NOT set — nobody can pay yet."}{" "}
          {data.webhookConfigured ? "Webhook secret is set." : "Webhook secret is NOT set."} Revenue{" "}
          {rupees(data.revenuePaise)} · refunded {rupees(data.refundedPaise)} · {data.owedListeners.toLocaleString("en-IN")}{" "}
          listeners still owed of {data.config.capacityListeners.toLocaleString("en-IN")} capacity.
        </p>
      </header>
    </section>
  );
}

function ConfigCard({ config }: { config: Config }) {
  const setConfig = useMutation(api.promotions.setConfig);
  const { notify } = useDialogs();
  const [draft, setDraft] = useState<Config>(config);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const edit = (patch: Partial<Config>) => setDraft((d) => ({ ...d, ...patch }));
  const editPkg = (i: number, patch: Partial<Pkg>) =>
    setDraft((d) => ({ ...d, packages: d.packages.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));

  const save = async () => {
    setSaving(true);
    try {
      await setConfig({ value: draft });
      notify("Promotion settings saved", "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't save", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <h3>Packages and pacing</h3>
        <p>List prices everyone sees (unless they have a personal rate). Prices in rupees; the floor is ₹49.</p>
      </header>
      <table className="admin-table promo-pkgs">
        <thead>
          <tr>
            <th>id</th>
            <th>name</th>
            <th>listeners</th>
            <th>price ₹</th>
            <th>per listener</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {draft.packages.map((p, i) => (
            <tr key={i}>
              <td>
                <input value={p.id} maxLength={24} onChange={(e) => editPkg(i, { id: e.target.value.toLowerCase() })} aria-label="package id" />
              </td>
              <td>
                <input value={p.name} maxLength={40} onChange={(e) => editPkg(i, { name: e.target.value })} aria-label="package name" />
              </td>
              <td>
                <input type="number" min={10} value={p.listeners} onChange={(e) => editPkg(i, { listeners: Number(e.target.value) })} aria-label="listeners" />
              </td>
              <td>
                <input type="number" min={49} step={1} value={p.pricePaise / 100} onChange={(e) => editPkg(i, { pricePaise: toPaise(e.target.value) })} aria-label="price in rupees" />
              </td>
              <td>₹{(p.pricePaise / 100 / Math.max(1, p.listeners)).toFixed(2)}</td>
              <td>
                <button className="aq-btn no" onClick={() => setDraft((d) => ({ ...d, packages: d.packages.filter((_, k) => k !== i) }))}>
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="admin-grid">
        <label className="field">
          <span>launch offer, % off a first campaign</span>
          <input type="number" min={0} max={90} value={draft.launchOffer.percentOff}
            onChange={(e) => edit({ launchOffer: { ...draft.launchOffer, percentOff: Number(e.target.value) } })} />
        </label>
        <label className="field">
          <span>capacity: listeners sellable per window</span>
          <input type="number" min={0} value={draft.capacityListeners}
            onChange={(e) => edit({ capacityListeners: Number(e.target.value) })} />
          <small className="field-hint">never sell more than the deck can reach</small>
        </label>
        <label className="field">
          <span>one promoted song every N cards</span>
          <input type="number" min={4} max={100} value={draft.everyNCards}
            onChange={(e) => edit({ everyNCards: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>promoted songs per listener per day</span>
          <input type="number" min={0} max={10} value={draft.perListenerDaily}
            onChange={(e) => edit({ perListenerDaily: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>days a campaign has to deliver</span>
          <input type="number" min={7} max={90} value={draft.windowDays}
            onChange={(e) => edit({ windowDays: Number(e.target.value) })} />
        </label>
        <label className="check-field">
          <input type="checkbox" checked={draft.launchOffer.enabled}
            onChange={(e) => edit({ launchOffer: { ...draft.launchOffer, enabled: e.target.checked } })} />
          <span>launch offer on</span>
        </label>
        <label className="check-field">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
          <span>promotion on (buying and dealing)</span>
        </label>
      </div>
      <footer className="admin-card-foot">
        <button className="aq-btn" onClick={() => setDraft((d) => ({ ...d, packages: [...d.packages, { id: `pkg${d.packages.length + 1}`, name: "New", listeners: 1000, pricePaise: 79_900 }] }))}>
          + package
        </button>
        <button className="aq-btn yes" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "saving…" : "save"}
        </button>
        {dirty && (
          <button className="aq-btn" onClick={() => setDraft(config)}>
            discard
          </button>
        )}
      </footer>
    </section>
  );
}

type Artist = { userId: string; artistName: string; email: string };

function RatesCard({ artists, rates }: { artists: Artist[]; rates: Overview["rates"] }) {
  const setRate = useMutation(api.promotions.setRate);
  const { notify, confirm } = useDialogs();
  const [userId, setUserId] = useState("");
  const [per1000, setPer1000] = useState("");
  const [note, setNote] = useState("");
  const name = (id: string) => artists.find((a) => a.userId === id)?.artistName ?? id.slice(0, 8);

  const save = async () => {
    try {
      await setRate({ userId, per1000Paise: per1000 ? toPaise(per1000) : undefined, note: note || undefined });
      notify(per1000 ? `Personal rate set for ${name(userId)}` : "Personal rate removed", "success");
      setPer1000("");
      setNote("");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't save", "error");
    }
  };

  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <h3>Personal rates</h3>
        <p>A price per 1,000 listeners for one artist; it re-prices every package for them only. They never see anyone else&apos;s.</p>
      </header>
      <div className="admin-grid">
        <div className="field">
          <span>artist</span>
          <Select
            label="artist"
            value={userId}
            onChange={setUserId}
            options={[
              { value: "", label: "choose an approved artist" },
              ...artists.map((a) => ({ value: a.userId, label: `${a.artistName} · ${a.email}` })),
            ]}
          />
        </div>
        <label className="field">
          <span>₹ per 1,000 listeners (empty removes)</span>
          <input type="number" min={10} value={per1000} onChange={(e) => setPer1000(e.target.value)} />
        </label>
        <label className="field">
          <span>note (why)</span>
          <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <footer className="admin-card-foot">
        <button className="aq-btn yes" disabled={!userId} onClick={() => void save()}>
          {per1000 ? "set rate" : "remove rate"}
        </button>
      </footer>
      {rates.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr><th>artist</th><th>per 1,000</th><th>own packages</th><th>note</th><th /></tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r._id}>
                <td>{name(r.userId)}</td>
                <td>{r.per1000Paise ? rupees(r.per1000Paise) : "—"}</td>
                <td>{r.customPackages?.map((p) => `${p.name} ${p.listeners}/${rupees(p.pricePaise)}`).join(", ") || "—"}</td>
                <td>{r.note ?? ""}</td>
                <td>
                  <button
                    className="aq-btn no"
                    onClick={() =>
                      void confirm({ title: `Remove ${name(r.userId)}'s personal rate?`, confirmLabel: "Remove", danger: true }).then(
                        async (ok) => {
                          if (!ok) return;
                          await setRate({ userId: r.userId });
                          notify("Removed", "success");
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

function CodesCard({ artists, codes }: { artists: Artist[]; codes: Overview["codes"] }) {
  const createCode = useMutation(api.promotions.createCode);
  const setCodeActive = useMutation(api.promotions.setCodeActive);
  const { notify } = useDialogs();
  const [f, setF] = useState({ code: "", kind: "percent" as "percent" | "amount", value: "", expires: "", maxUses: "", creator: "" });

  const create = async () => {
    try {
      await createCode({
        code: f.code,
        percentOff: f.kind === "percent" ? Number(f.value) : undefined,
        amountOffPaise: f.kind === "amount" ? toPaise(f.value) : undefined,
        expiresAt: f.expires ? new Date(`${f.expires}T23:59:59+05:30`).getTime() : undefined,
        maxUses: f.maxUses ? Number(f.maxUses) : undefined,
        creatorUserId: f.creator || undefined,
      });
      notify(`Code ${f.code.toUpperCase()} created`, "success");
      setF({ code: "", kind: "percent", value: "", expires: "", maxUses: "", creator: "" });
    } catch (e) {
      notify(e instanceof Error ? e.message.split("\n")[0] : "Couldn't create", "error");
    }
  };

  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <h3>Codes</h3>
        <p>Launch and discount codes. They stack after the launch offer; no order goes below ₹49.</p>
      </header>
      <div className="admin-grid">
        <label className="field">
          <span>code</span>
          <input maxLength={24} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="LAUNCH50" />
        </label>
        <label className="field">
          <span>{f.kind === "percent" ? "% off" : "₹ off"}</span>
          <input type="number" min={1} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
        </label>
        <div className="field">
          <span>kind</span>
          <Select
            label="kind of discount"
            value={f.kind}
            onChange={(kind) => setF({ ...f, kind })}
            options={[
              { value: "percent", label: "percent off" },
              { value: "amount", label: "rupees off" },
            ]}
          />
        </div>
        <label className="field">
          <span>expires (optional)</span>
          <input type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} />
        </label>
        <label className="field">
          <span>max uses (optional)</span>
          <input type="number" min={1} value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })} />
        </label>
        <div className="field">
          <span>only for (optional)</span>
          <Select
            label="only for artist"
            value={f.creator}
            onChange={(creator) => setF({ ...f, creator })}
            options={[{ value: "", label: "any artist" }, ...artists.map((a) => ({ value: a.userId, label: a.artistName }))]}
          />
        </div>
      </div>
      <footer className="admin-card-foot">
        <button className="aq-btn yes" disabled={f.code.length < 3 || !f.value} onClick={() => void create()}>
          create code
        </button>
      </footer>
      {codes.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr><th>code</th><th>off</th><th>uses</th><th>expires</th><th>status</th><th /></tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c._id}>
                <td>{c.code}</td>
                <td>{c.percentOff ? `${c.percentOff}%` : c.amountOffPaise ? rupees(c.amountOffPaise) : "—"}</td>
                <td>{c.uses}{c.maxUses ? ` / ${c.maxUses}` : ""}</td>
                <td>{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("en-IN") : "never"}</td>
                <td>{c.active ? "active" : "off"}</td>
                <td>
                  <button className="aq-btn" onClick={() => void setCodeActive({ code: c.code, active: !c.active })}>
                    {c.active ? "switch off" : "switch on"}
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

function CampaignsCard({ data }: { data: Overview }) {
  const name = (id: string) => data.artists.find((a) => a.userId === id)?.artistName ?? id.slice(0, 8);
  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <h3>Campaigns</h3>
        <p>Newest first. Refunds are issued automatically when a campaign is cancelled or runs out of time.</p>
      </header>
      {data.campaigns.length === 0 ? (
        <p className="admin-empty">No campaigns yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr><th>song</th><th>artist</th><th>status</th><th>reached</th><th>saves</th><th>ends</th><th>refund</th></tr>
          </thead>
          <tbody>
            {data.campaigns.map((c) => (
              <tr key={c._id}>
                <td>{data.titles[c.trackId] ?? c.trackId}</td>
                <td>{name(c.userId)}</td>
                <td>{c.status}</td>
                <td>{c.delivered} / {c.listeners}</td>
                <td>{c.stats.saves}</td>
                <td>{new Date(c.endsAt).toLocaleDateString("en-IN")}</td>
                <td>{c.refundPaise ? `${rupees(c.refundPaise)} ${c.refundStatus ?? ""}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="field-hint">
        {data.orders.filter((o) => o.status === "paid").length} paid orders ·{" "}
        {data.orders.filter((o) => o.status === "created").length} started but not paid ·{" "}
        {data.orders.filter((o) => o.status === "failed").length} failed
      </p>
    </section>
  );
}
