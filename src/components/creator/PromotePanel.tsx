import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MOODS } from "../../data/mood";
import { Select, useDialogs } from "../ui/Dialogs";
import type { Track } from "./types";

/**
 * Promote a song — as a request (convex/promotions.ts, docs/PROMOTIONS.md).
 * The artist asks; an admin approves, which fixes the price, or rejects with a
 * reason, and either way an email follows. Only an approved request can be
 * paid, at exactly the approved amount, within its 7-day window.
 *
 * Web only: the Android app never links here, because Google Play forbids
 * leading app users to a payment outside Play Billing.
 */

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const day = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  theme: { color: string };
  handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal: { ondismiss: () => void };
};
type RazorpayCtor = new (o: RazorpayOptions) => { open: () => void };

/** Razorpay's checkout script, loaded only when someone actually pays. */
function loadCheckout(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Checkout didn't load")));
    s.onerror = () => reject(new Error("Couldn't reach the payment page — check your connection."));
    document.head.appendChild(s);
  });
}

const errorText = (err: unknown) =>
  err instanceof Error ? err.message.replace(/^[\s\S]*Uncaught Error: /, "").split("\n")[0] : "Something went wrong";

const STATUS_LABEL: Record<string, string> = {
  requested: "waiting for review",
  approved: "approved — ready to pay",
  rejected: "not approved",
  paid: "paid — running",
  expired: "approval lapsed",
  withdrawn: "withdrawn",
};

export function PromotePanel({ tracks }: { tracks: Track[] }) {
  const offer = useQuery(api.promotions.offer);
  const requests = useQuery(api.promotions.myRequests);
  const campaigns = useQuery(api.promotions.myCampaigns);
  const requestPromotion = useMutation(api.promotions.requestPromotion);
  const withdrawRequest = useMutation(api.promotions.withdrawRequest);
  const beginOrder = useMutation(api.promotions.beginOrder);
  const checkout = useAction(api.promotions.checkout);
  const confirmPayment = useAction(api.promotions.confirmPayment);
  const cancelCampaign = useMutation(api.promotions.cancelCampaign);
  const { confirm, notify } = useDialogs();

  const live = tracks.filter((t) => !t.hidden && (t.audioUrl || t.previewUrl));
  const [trackId, setTrackId] = useState("");
  const [choice, setChoice] = useState<string>(""); // a package id, or "custom"
  const [moods, setMoods] = useState<string[]>([]);
  const [genres, setGenres] = useState("");
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (offer === undefined) return null;
  const chosenTrack = trackId || live[0]?.trackId || "";
  const chosen = offer.packages.find((p) => p.id === choice) ?? null;

  const submit = async () => {
    setBusy("request");
    setError(null);
    try {
      await requestPromotion({
        trackId: chosenTrack,
        packageId: choice === "custom" ? undefined : choice,
        customQuote: choice === "custom",
        moods,
        genres: genres.split(",").map((g) => g.trim()).filter(Boolean),
        note: note.trim() || undefined,
        code: code.trim() || undefined,
      });
      notify("Request sent — we'll email you when it's reviewed.", "success");
      setChoice("");
      setMoods([]);
      setGenres("");
      setNote("");
      setCode("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const pay = async (requestId: string, title: string, listeners: number) => {
    setBusy(requestId);
    setError(null);
    try {
      const { orderId } = await beginOrder({ requestId: requestId as Id<"promotionRequests"> });
      const co = await checkout({ orderId: orderId as Id<"promotionOrders"> });
      if (!co.configured) {
        setError("Payments aren't switched on yet — your approval is saved; we'll email you when paying opens.");
        return;
      }
      const Razorpay = await loadCheckout();
      await new Promise<void>((done) => {
        new Razorpay({
          key: co.keyId,
          amount: co.amount,
          currency: co.currency,
          name: "hookedcue",
          description: `${listeners.toLocaleString("en-IN")} listeners · ${title}`,
          order_id: co.razorpayOrderId,
          theme: { color: "#ff3d71" },
          handler: (r) => {
            void confirmPayment({
              razorpayOrderId: r.razorpay_order_id,
              razorpayPaymentId: r.razorpay_payment_id,
              razorpaySignature: r.razorpay_signature,
            })
              .then(() => notify("Paid — your song is in the deck now.", "success"))
              .catch(() =>
                setError(
                  "Your payment went through but we couldn't confirm it yet. It will show here within a few minutes; if not, email hello@hookedcue.com.",
                ),
              )
              .finally(done);
          },
          modal: { ondismiss: done },
        }).open();
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async (id: string, title: string) => {
    if (!(await confirm({ title: `Withdraw the request for “${title}”?`, confirmLabel: "Withdraw" }))) return;
    try {
      await withdrawRequest({ requestId: id as Id<"promotionRequests"> });
    } catch (err) {
      notify(errorText(err), "error");
    }
  };

  const stop = async (id: string, title: string) => {
    const ok = await confirm({
      title: `Stop promoting “${title}”?`,
      body: "Listeners not reached yet are refunded to the way you paid, in 5–7 business days.",
      confirmLabel: "Stop and refund",
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await cancelCampaign({ campaignId: id as Id<"promotionCampaigns"> });
      notify(r.refundPaise > 0 ? `Stopped. ${rupees(r.refundPaise)} is on its way back.` : "Stopped.", "success");
    } catch (err) {
      notify(errorText(err), "error");
    }
  };

  return (
    <section className="promote" aria-labelledby="promote-title">
      <header className="promote-head">
        <h3 id="promote-title">Promote a song</h3>
        <p>
          Ask to have your song dealt, at its hook, to listeners who haven&apos;t heard it. We review every
          request; once it&apos;s approved you pay the approved price within 7 days. A listen counts from
          3 seconds, once per person; whatever we don&apos;t reach in {offer.windowDays} days is refunded.
          Promoted songs are labelled <strong>Promoted</strong>.{" "}
          <a href="https://hookedcue.com/artists" target="_blank" rel="noreferrer">
            How it works
          </a>
        </p>
      </header>

      {!offer.enabled ? (
        <p className="aq-empty">Promotion is paused right now.</p>
      ) : live.length === 0 ? (
        <p className="aq-empty">Publish a song with audio first — then you can ask to promote it.</p>
      ) : (
        <div className="promote-form">
          {offer.launchOffer > 0 && (
            <p className="promote-note on">Launch offer: {offer.launchOffer}% off your first campaign.</p>
          )}
          <div className="promote-field">
            <span>song</span>
            <Select
              label="song to promote"
              value={chosenTrack}
              onChange={setTrackId}
              options={live.map((t) => ({ value: t.trackId, label: `${t.title} — ${t.artist}` }))}
            />
          </div>

          <div className="promote-packages" role="radiogroup" aria-label="package">
            {offer.packages.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={choice === p.id}
                disabled={!p.available}
                className={choice === p.id ? "promote-pkg on" : "promote-pkg"}
                onClick={() => setChoice(p.id)}
              >
                <strong>{p.name}</strong>
                <span>{p.listeners.toLocaleString("en-IN")} listeners</span>
                <b>
                  {p.quote.totalPaise < p.quote.basePaise && <s>{rupees(p.quote.basePaise)}</s>}{" "}
                  {rupees(p.quote.totalPaise)}
                </b>
                {!p.available && <em>full for now</em>}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={choice === "custom"}
              className={choice === "custom" ? "promote-pkg on" : "promote-pkg"}
              onClick={() => setChoice("custom")}
            >
              <strong>Custom</strong>
              <span>something else</span>
              <b>ask for a quote</b>
            </button>
          </div>

          <div className="promote-field">
            <span>who should hear it (optional)</span>
            <div className="promote-moods" role="group" aria-label="moods">
              {MOODS.map((m) => {
                const on = moods.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    className={on ? "promote-chip on" : "promote-chip"}
                    onClick={() => setMoods((xs) => (on ? xs.filter((x) => x !== m.id) : [...xs, m.id]))}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            <input
              className="auth-input"
              placeholder="genres, comma separated — e.g. indie, lo-fi"
              value={genres}
              maxLength={160}
              onChange={(e) => setGenres(e.target.value)}
              aria-label="genres"
            />
          </div>

          <label className="promote-field">
            <span>a note for us (optional)</span>
            <textarea
              className="auth-input promote-note-input"
              value={note}
              maxLength={500}
              rows={3}
              placeholder={choice === "custom" ? "What are you after? Listeners, timing, budget…" : "Anything we should know?"}
              onChange={(e) => setNote(e.target.value)}
            />
            <small className="promote-count">{note.length}/500</small>
          </label>

          <input
            className="auth-input"
            placeholder="code (optional)"
            value={code}
            maxLength={24}
            onChange={(e) => setCode(e.target.value)}
            aria-label="discount code"
          />

          {chosen && (
            <p className="promote-fine">
              You&apos;d pay about {rupees(chosen.quote.totalPaise)} for {chosen.listeners.toLocaleString("en-IN")} listeners.
              The exact price is fixed when we approve it — nothing is charged now.
            </p>
          )}
          {error && <p className="access-error">{error}</p>}
          <button
            type="button"
            className="aq-btn yes promote-pay"
            disabled={!choice || !chosenTrack || busy !== null}
            onClick={() => void submit()}
          >
            {busy === "request" ? "sending…" : choice ? "request promotion" : "pick a package or ask for a quote"}
          </button>
        </div>
      )}

      {requests && requests.length > 0 && (
        <div className="promote-campaigns">
          <h4>Your requests</h4>
          {requests.map((r) => (
            <article key={r.id} className="promote-campaign">
              <header>
                <strong>{r.title}</strong>
                <span className={`promote-status ${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
              </header>
              {r.approved && r.status === "approved" && r.expiresAt && (
                <>
                  <p>
                    Approved: {r.approved.listeners.toLocaleString("en-IN")} listeners for{" "}
                    <strong>{rupees(r.approved.totalPaise)}</strong>
                    {r.approved.launchOffPaise + r.approved.codeOffPaise > 0 &&
                      ` (was ${rupees(r.approved.basePaise)})`}
                    . Pay by {day(r.expiresAt)}.
                  </p>
                  {r.approved.note && <p className="promote-fine">From us: {r.approved.note}</p>}
                  <button
                    type="button"
                    className="aq-btn yes promote-pay"
                    disabled={busy !== null}
                    onClick={() => void pay(r.id, r.title, r.approved!.listeners)}
                  >
                    {busy === r.id ? "opening payment…" : `pay ${rupees(r.approved.totalPaise)} and start`}
                  </button>
                </>
              )}
              {r.status === "rejected" && r.rejectReason && <p>Why: {r.rejectReason}</p>}
              {r.status === "requested" && (
                <p className="promote-fine">
                  {r.customQuote ? "Custom quote asked" : `Package: ${r.packageId}`} · sent {day(r.createdAt)}
                </p>
              )}
              {(r.status === "requested" || r.status === "approved") && (
                <button type="button" className="aq-btn" onClick={() => void withdraw(r.id, r.title)}>
                  withdraw
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {campaigns && campaigns.length > 0 && (
        <div className="promote-campaigns">
          <h4>Your campaigns</h4>
          {campaigns.map((c) => (
            <article key={c.id} className="promote-campaign">
              <header>
                <strong>{c.title}</strong>
                <span className={`promote-status ${c.status}`}>{c.status}</span>
              </header>
              <div className="promote-bar" aria-label={`${c.delivered} of ${c.listeners} listeners reached`}>
                <i style={{ width: `${Math.min(100, (c.delivered / Math.max(1, c.listeners)) * 100)}%` }} />
              </div>
              <p>
                {c.delivered.toLocaleString("en-IN")} of {c.listeners.toLocaleString("en-IN")} listeners ·{" "}
                {c.stats.saves} saves · {c.saveRate}% save rate · {c.stats.more} more like this ·{" "}
                {c.stats.skips} skips · {c.stats.never} nevers
              </p>
              <p className="promote-fine">
                paid {rupees(c.paidPaise)}
                {c.status === "active" && ` · ends ${new Date(c.endsAt).toLocaleDateString("en-IN")}`}
                {c.refundPaise > 0 && ` · refund ${rupees(c.refundPaise)} (${c.refundStatus ?? "pending"})`}
              </p>
              {c.status === "active" && (
                <button type="button" className="aq-btn no" onClick={() => void stop(c.id, c.title)}>
                  stop and refund the rest
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
