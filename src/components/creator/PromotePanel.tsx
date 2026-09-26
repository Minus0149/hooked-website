import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Select, useDialogs } from "../ui/Dialogs";
import type { Track } from "./types";

/**
 * Pay to have one of your own songs heard (convex/promotions.ts,
 * docs/PROMOTIONS.md). Web only: the Android app never links here, because
 * Google Play forbids leading app users to a payment outside Play Billing.
 *
 * The browser never names a price. It picks a package (and maybe a code); the
 * server prices it, creates the Razorpay order for that exact amount, and only
 * a payment Razorpay has signed becomes a campaign.
 */

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

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

export function PromotePanel({ tracks }: { tracks: Track[] }) {
  const offer = useQuery(api.promotions.offer);
  const campaigns = useQuery(api.promotions.myCampaigns);
  const beginOrder = useMutation(api.promotions.beginOrder);
  const checkout = useAction(api.promotions.checkout);
  const confirmPayment = useAction(api.promotions.confirmPayment);
  const cancelCampaign = useMutation(api.promotions.cancelCampaign);
  const { confirm, notify } = useDialogs();

  const live = tracks.filter((t) => !t.hidden && (t.audioUrl || t.previewUrl));
  const [trackId, setTrackId] = useState<string>("");
  const [packageId, setPackageId] = useState<string>("");
  const [code, setCode] = useState("");
  const [codeApplied, setCodeApplied] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenTrack = trackId || live[0]?.trackId || "";
  const preview = useQuery(
    api.promotions.previewPrice,
    packageId && codeApplied ? { packageId, code: codeApplied } : "skip",
  );

  if (offer === undefined) return null;
  const chosen = offer.packages.find((p) => p.id === packageId) ?? null;
  const price = preview?.ok ? preview.quote : chosen?.quote ?? null;

  const pay = async () => {
    if (!chosen || !chosenTrack) return;
    setBusy(true);
    setError(null);
    try {
      const { orderId } = await beginOrder({
        trackId: chosenTrack,
        packageId: chosen.id,
        code: codeApplied || undefined,
      });
      const co = await checkout({ orderId: orderId as Id<"promotionOrders"> });
      if (!co.configured) {
        setError("Payments aren't switched on yet — we'll email you when promotion opens.");
        return;
      }
      const Razorpay = await loadCheckout();
      const song = live.find((t) => t.trackId === chosenTrack);
      await new Promise<void>((done) => {
        new Razorpay({
          key: co.keyId,
          amount: co.amount,
          currency: co.currency,
          name: "hookedcue",
          description: `${chosen.name} · ${chosen.listeners.toLocaleString("en-IN")} listeners${song ? ` · ${song.title}` : ""}`,
          order_id: co.razorpayOrderId,
          theme: { color: "#ff3d71" },
          handler: (r) => {
            void confirmPayment({
              razorpayOrderId: r.razorpay_order_id,
              razorpayPaymentId: r.razorpay_payment_id,
              razorpaySignature: r.razorpay_signature,
            })
              .then(() => {
                notify("Paid — your song is in the deck now.", "success");
                setPackageId("");
                setCode("");
                setCodeApplied("");
              })
              .catch(() =>
                setError(
                  "Your payment went through but we couldn't confirm it yet. It will appear here within a few minutes; if not, email hello@hookedcue.com.",
                ),
              )
              .finally(done);
          },
          modal: { ondismiss: done },
        }).open();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Something went wrong");
    } finally {
      setBusy(false);
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
      notify(err instanceof Error ? err.message : "Couldn't stop it", "error");
    }
  };

  return (
    <section className="promote" aria-labelledby="promote-title">
      <header className="promote-head">
        <h3 id="promote-title">Promote a song</h3>
        <p>
          Your song, dealt at its hook to listeners who haven&apos;t heard it. A listen counts from 3
          seconds, once per person; whatever we don&apos;t reach in {offer.windowDays} days is refunded.
          Promoted songs are labelled <strong>Promoted</strong>.{" "}
          <a href="https://hookedcue.com/artists" target="_blank" rel="noreferrer">
            How it works
          </a>
        </p>
      </header>

      {!offer.enabled ? (
        <p className="aq-empty">Promotion is paused right now.</p>
      ) : live.length === 0 ? (
        <p className="aq-empty">Publish a song with audio first — then you can promote it.</p>
      ) : (
        <div className="promote-form">
          {!offer.paymentsConfigured && (
            <p className="promote-note">Payments aren&apos;t switched on yet. You can look around; paying opens soon.</p>
          )}
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
            {offer.packages.map((p) => {
              const on = p.id === packageId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!p.available}
                  className={on ? "promote-pkg on" : "promote-pkg"}
                  onClick={() => setPackageId(p.id)}
                >
                  <strong>{p.name}</strong>
                  <span>{p.listeners.toLocaleString("en-IN")} listeners</span>
                  <b>
                    {p.quote.totalPaise < p.quote.basePaise && <s>{rupees(p.quote.basePaise)}</s>}{" "}
                    {rupees(p.quote.totalPaise)}
                  </b>
                  {!p.available && <em>full for now</em>}
                </button>
              );
            })}
          </div>

          <div className="promote-code">
            <input
              className="auth-input"
              placeholder="code (optional)"
              value={code}
              maxLength={24}
              onChange={(e) => setCode(e.target.value)}
              aria-label="discount code"
            />
            <button
              type="button"
              className="aq-btn"
              disabled={!code.trim() || !packageId}
              onClick={() => setCodeApplied(code.trim())}
            >
              apply
            </button>
          </div>
          {codeApplied && preview && !preview.ok && <p className="access-error">{preview.reason}</p>}

          {chosen && price && (
            <dl className="promote-sum">
              <div>
                <dt>{chosen.name}</dt>
                <dd>{rupees(price.basePaise)}</dd>
              </div>
              {price.launchOffPaise > 0 && (
                <div>
                  <dt>launch offer</dt>
                  <dd>− {rupees(price.launchOffPaise)}</dd>
                </div>
              )}
              {price.codeOffPaise > 0 && (
                <div>
                  <dt>code {codeApplied.toUpperCase()}</dt>
                  <dd>− {rupees(price.codeOffPaise)}</dd>
                </div>
              )}
              <div className="total">
                <dt>you pay</dt>
                <dd>{rupees(price.totalPaise)}</dd>
              </div>
            </dl>
          )}
          {error && <p className="access-error">{error}</p>}
          <button
            type="button"
            className="aq-btn yes promote-pay"
            disabled={!chosen || !chosen.available || busy}
            onClick={() => void pay()}
          >
            {busy ? "opening payment…" : price ? `pay ${rupees(price.totalPaise)}` : "pick a package"}
          </button>
          <p className="promote-fine">
            Payments by Razorpay: UPI, cards, netbanking. Prices in INR and final. See the{" "}
            <a href="https://hookedcue.com/refunds" target="_blank" rel="noreferrer">
              refunds policy
            </a>
            .
          </p>
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
