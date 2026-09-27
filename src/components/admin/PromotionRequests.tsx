import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Select, useDialogs } from "../ui/Dialogs";

/**
 * Promotion requests waiting for a decision (convex/promotions.ts). Listen to
 * the hook, read what the artist asked for, then approve — which fixes the
 * price the artist will pay — or reject with a reason. Both send the artist an
 * email. Nothing is charged until they pay an approval.
 */

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const errorText = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught Error: /, "").split("\n")[0] : "Something went wrong";

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.promotions.adminRequests>>>[number];

/** Plays the hook — the part listeners will actually hear — and stops at its end. */
function HookPlayer({ src, startMs, durationMs }: { src: string; startMs: number; durationMs: number }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = () => {
    const a = audio.current ?? new Audio(src);
    audio.current = a;
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    a.currentTime = startMs / 1000;
    a.ontimeupdate = () => {
      if (a.currentTime * 1000 >= startMs + durationMs) {
        a.pause();
        setPlaying(false);
      }
    };
    a.onended = () => setPlaying(false);
    void a
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  };
  return (
    <button
      type="button"
      className="aq-btn promo-play"
      onClick={toggle}
      aria-label={playing ? "stop the hook" : "play the hook"}
    >
      {playing ? "■ stop" : "▶ hook"}
    </button>
  );
}

function RequestRow({ r }: { r: Row }) {
  const approve = useMutation(api.promotions.approveRequest);
  const reject = useMutation(api.promotions.rejectRequest);
  const { notify } = useDialogs();
  const [pkg, setPkg] = useState<string>(r.packageId ?? (r.customQuote ? "custom" : r.packages[0]?.id ?? "custom"));
  const [listeners, setListeners] = useState("1000");
  const [price, setPrice] = useState("");
  const [code, setCode] = useState(r.code ?? "");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const open = r.status === "requested";

  const doApprove = async () => {
    setBusy(true);
    try {
      const out = await approve({
        requestId: r.id as Id<"promotionRequests">,
        packageId: pkg === "custom" ? undefined : pkg,
        custom: pkg === "custom" ? { listeners: Number(listeners), pricePaise: Math.round(Number(price) * 100) } : undefined,
        code: code.trim(),
        note: note.trim() || undefined,
      });
      notify(
        `Approved at ${rupees(out.quote.totalPaise)}${out.emailed ? " — artist emailed" : " — no email on file"}`,
        "success",
      );
    } catch (e) {
      notify(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const doReject = async () => {
    setBusy(true);
    try {
      const out = await reject({ requestId: r.id as Id<"promotionRequests">, reason: reason.trim() });
      notify(out.emailed ? "Rejected — artist emailed" : "Rejected — no email on file", "success");
    } catch (e) {
      notify(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const t = r.track;
  return (
    <article className="promo-req">
      <header className="promo-req-head">
        {t?.artwork ? <img className="creator-art" src={t.artwork} alt="" /> : <div className="creator-art creator-art-blank" />}
        <div className="promo-req-who">
          <strong>{t?.title ?? "(song removed)"}</strong>
          <span>
            {t?.artist} · {r.artist.name} · {r.artist.email || "no email"}
          </span>
          <span className="promo-req-meta">
            {r.customQuote ? "asked for a custom quote" : `asked for ${r.packageId}`}
            {r.code ? ` · code ${r.code}` : ""}
            {r.hasPersonalRate ? " · has a personal rate" : ""} · {new Date(r.createdAt).toLocaleDateString("en-IN")}
          </span>
        </div>
        <span className={`promote-status ${r.status}`}>{r.status}</span>
      </header>
      <div className="promo-req-body">
        {t?.audio && <HookPlayer src={t.audio} startMs={t.hookStartMs} durationMs={t.hookDurationMs} />}
        <p>
          <strong>Rights:</strong>{" "}
          {t?.uploaded
            ? t.rightsConfirmedAt
              ? `uploaded by the artist, rights confirmed ${new Date(t.rightsConfirmedAt).toLocaleDateString("en-IN")}`
              : "uploaded by the artist, rights NOT confirmed"
            : "catalogue song, not an upload — check the artist owns it"}
          {t?.hidden ? " · the song is hidden" : ""}
        </p>
        {(r.target.moods.length > 0 || r.target.genres.length > 0) && (
          <p>
            <strong>Target:</strong> {[...r.target.moods, ...r.target.genres].join(", ")}
          </p>
        )}
        {r.note && (
          <p>
            <strong>Note:</strong> {r.note}
          </p>
        )}
        {r.approved && (
          <p>
            <strong>Approved:</strong> {r.approved.listeners.toLocaleString("en-IN")} listeners at{" "}
            {rupees(r.approved.totalPaise)}
            {r.expiresAt ? ` · pay by ${new Date(r.expiresAt).toLocaleDateString("en-IN")}` : ""}
          </p>
        )}
        {r.rejectReason && (
          <p>
            <strong>Rejected:</strong> {r.rejectReason}
          </p>
        )}
      </div>
      {open && (
        <div className="promo-req-actions">
          <div className="admin-grid">
            <div className="field">
              <span>package</span>
              <Select
                label="package to approve"
                value={pkg}
                onChange={setPkg}
                options={[
                  ...r.packages.map((p) => ({
                    value: p.id,
                    label: `${p.name} · ${p.listeners.toLocaleString("en-IN")} · ${rupees(p.pricePaise)}`,
                  })),
                  { value: "custom", label: "custom price" },
                ]}
              />
            </div>
            {pkg === "custom" && (
              <>
                <label className="field">
                  <span>listeners</span>
                  <input type="number" min={10} value={listeners} onChange={(e) => setListeners(e.target.value)} />
                </label>
                <label className="field">
                  <span>price ₹ (before launch offer and code)</span>
                  <input type="number" min={49} value={price} onChange={(e) => setPrice(e.target.value)} />
                </label>
              </>
            )}
            <label className="field">
              <span>code (empty for none)</span>
              <input maxLength={24} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </label>
            <label className="field">
              <span>note to the artist (optional)</span>
              <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <footer className="admin-card-foot">
            <button className="aq-btn yes" disabled={busy || (pkg === "custom" && !price)} onClick={() => void doApprove()}>
              approve and email
            </button>
          </footer>
          <label className="field promo-req-reason">
            <span>or reject — the reason is emailed to the artist</span>
            <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <footer className="admin-card-foot">
            <button className="aq-btn no" disabled={busy || reason.trim().length < 3} onClick={() => void doReject()}>
              reject and email
            </button>
          </footer>
        </div>
      )}
    </article>
  );
}

export function PromotionRequests() {
  const rows = useQuery(api.promotions.adminRequests);
  const waiting = rows?.filter((r) => r.status === "requested").length ?? 0;
  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <h3>Requests{waiting ? ` (${waiting} waiting)` : ""}</h3>
        <p>Approve fixes the price the artist pays (valid 7 days); reject needs a reason. Both email the artist.</p>
      </header>
      {rows === undefined ? (
        <p className="admin-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="admin-empty">No requests yet.</p>
      ) : (
        rows.map((r) => <RequestRow key={r.id} r={r} />)
      )}
    </section>
  );
}
