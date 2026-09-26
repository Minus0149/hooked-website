# Paid promotion for artists

Approved artists pay to have one of their own published songs dealt, at its
hook, to listeners who haven't heard it. They buy a number of **distinct
listeners**, not impressions. Code: `convex/promotionRules.ts` (every rule and
price, tested in `tests/promotion-rules.test.ts`) and `convex/promotions.ts`
(storage, Razorpay, dealing). Public pages: hookedcue.com/artists,
/refunds, /contact.

## What counts as a listen

A promoted card is dealt as a normal, playable card labelled **Promoted**.
A listen counts when the card has played for **3 seconds or more**, once per
listener per campaign, counted on the server (`recordPromoted`). Swipes on it
(save, skip, more like this, never) are recorded once per listener and shown
to the artist with the **save rate**. There are no bots and no incentives: a
listen is someone who was already swiping through music.

Pacing (admin-editable): at most one promoted card in every 10 cards (client),
at most 2 promoted cards per listener per day, never the same campaign to the
same listener twice (server). Campaigns furthest behind a straight-line
schedule are dealt first.

## Prices: what hearing a song costs elsewhere (September 2026)

| Channel | Published cost | Per genuine listen, roughly |
|---|---|---|
| Instagram Reels ads, India | CPM ₹45–140 for Reels, ₹45–350 across Instagram | a paid Reels impression is not a listen: most are scrolled past, so ₹0.30–1 per real 3-second hear is typical |
| YouTube in-stream, India | ₹0.50–3 per view, skippable in-stream ₹2–3; music video promotion from ₹826 per 1,000 views | ₹1–3 |
| Spotify Showcase / Marquee | $0.30–0.40 (Showcase) and $0.55–1.50 (Marquee) per click, $100 minimum | ₹25–125 per click-to-listen |
| Spotify Discovery Mode | no fee; 30% lower royalty on boosted streams; needs 25,000 monthly listeners | not available to a new artist |
| SubmitHub | about $0.80–1 per premium submission | ₹70–85 per curator, not per listener |
| Groover | €2 per contact, top curators €4–6 | ₹185–550 per curator |
| Playlist Push | campaigns from $280 | ₹23,000+ |
| Bot-stream sellers | fractions of a rupee per 1,000 streams | these are fake; we must never look like them |

hookedcue's position: **₹0.60–1.00 per distinct listener who actually hears
the hook**, targeted to people already listening to music. That's below
YouTube's per-view cost and far below Spotify's per click, in the same range
as a genuine Reels listen, and about a thousand times what fake-stream
sellers charge, so it can't be mistaken for one.

### Default packages (admin can change all of it)

| Package | Listeners | Price | Per listener |
|---|---|---|---|
| Try it | 100 | ₹99 | ₹0.99 |
| Starter | 500 | ₹399 | ₹0.80 |
| Boost | 2,000 | ₹1,399 | ₹0.70 |
| Launch | 5,000 | ₹2,999 | ₹0.60 |

- **Launch offer:** 50% off an artist's first campaign. On by default; an
  admin switches it off.
- **Personal rates:** an admin can give one artist a price per 1,000
  listeners (which re-prices every package for them) and/or packages only
  they see. An artist only ever sees their own prices.
- **Codes:** percent or amount off, optional expiry, use limit and single
  artist. Stack after the launch offer; no order goes below ₹49.
- **Capacity:** the platform only sells as many listeners as it can deliver
  in a window (default 1,000 while in beta). A package bigger than what's
  left shows as full. Selling 5,000 listeners to a 12-person beta would
  only mean refunds.
- **No GST line** until hookedcue registers for GST (not required below the
  ₹20 lakh turnover threshold for services). Prices are final.

## Refunds and cancellation

- A campaign has 30 days (admin-editable) to deliver.
- **Cancel any time** from the creator dashboard, or reach the end of the
  window: the undelivered share is refunded **pro rata** (`refundFor`,
  rounded down), automatically, through Razorpay's refunds API. Razorpay
  returns it to the original payment method in 5–7 business days.
- An account with a running campaign must cancel it before deleting the
  account, so the refund is issued first.
- Payment records are kept 8 years (Indian tax law); everything else about
  a campaign goes with the account.

## Payments: Razorpay

- **Order:** `POST https://api.razorpay.com/v1/orders`, basic auth with key
  id and secret, `amount` in paise, `currency: "INR"`, `receipt` (≤ 40
  chars). The amount is our stored `totalPaise`; the reply's amount is
  checked against it.
- **Checkout (web only):** `https://checkout.razorpay.com/v1/checkout.js`,
  options `key`, `amount`, `currency`, `name`, `order_id`, `handler`.
- **Verify:** `hmac_sha256(order_id + "|" + razorpay_payment_id, key_secret)`
  must equal `razorpay_signature` (`paymentSignatureValid`).
- **Webhook:** `POST /razorpay/webhook` on the Convex site URL. The
  `X-Razorpay-Signature` header is HMAC-SHA256 of the **raw** body with the
  webhook secret; duplicates are dropped by `x-razorpay-event-id`. Events:
  `order.paid`, `payment.captured`, `payment.failed`, `refund.processed`,
  `refund.failed`.
- **Test mode:** test keys never move money; test UPI `success@razorpay` /
  `failure@razorpay`.
- **Env on the Convex deployment:** `RAZORPAY_KEY_ID`,
  `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Without them the offer
  says payments aren't configured and nothing can be bought.
- **Account activation needs these website pages:** about, contact (with
  phone and address), pricing in INR, terms, privacy, refund and
  cancellation policy with timelines, linked from the footer. hookedcue.com
  has terms, privacy, /artists (pricing), /refunds and /contact.

## Disclosure

India's advertising code (ASCI) requires paid promotion to be clearly marked
as such, with labels like "Ad", "Sponsored" or "Paid partnership", visible
without clicking. Every promoted card carries **Promoted** on the card itself.

## Google Play

Play's payments policy requires Google Play Billing for digital content and
services bought *in the app*, and forbids leading app users to another
payment method with buttons, links or calls to action. Its exemptions
(physical goods, bills, peer-to-peer, gambling) don't clearly cover selling
promotion to creators. So:

- promotion is **bought only on the web** (app.hookedcue.com/creator), never
  in the Android app;
- the Android app shows **no buy button and no link to buying**: its
  "Creator dashboard" row becomes plain text ("creator tools are on the web")
  without a link, in phase B;
- listeners in the app see promoted cards, which Play treats like any ad
  (the listing already declares "contains ads").

## Sources

- Razorpay Standard Checkout integration steps: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
- Razorpay webhook validation: https://razorpay.com/docs/webhooks/validate-test/
- Razorpay business website requirements: https://razorpay.com/docs/payments/dashboard/account-settings/business-website-details/ and https://razorpay.com/blog/payment-gateway-compliance/
- ASCI disclosure guidelines: https://www.ascionline.in/social/guidelines/
- Google Play Payments policy: https://support.google.com/googleplay/android-developer/answer/9858738
- Instagram ads India 2026: https://upgrowth.in/instagram-ads-pricing-india-2026/
- YouTube ads India 2026: https://megadigital.ai/en/blog/youtube-ads-cost-in-india/ and https://techbullion.com/youtube-views-cost-in-india-2026-real-ad-driven-promotion-starting-at-inr-826-per-1000-views/
- Spotify Marquee/Showcase budgets: https://support.spotify.com/us/artists/article/marquee-payment-and-budget/ and https://orphiq.com/resources/spotify-promotion-guide
- Spotify Discovery Mode: https://support.spotify.com/us/artists/article/using-discovery-mode-in-spotify-for-artists/
- SubmitHub and Groover pricing 2026: https://www.musicpulse.app/blog/submithub-groover-playlistpush-which-service-should-you-choose-in-2026 and https://dynamoi.com/vs/groover-vs-submithub
- Playlist Push and promotion services: https://soundcamps.com/blog/best-spotify-promotion-services/
