# iTunes preview attribution

hookedcue plays 30-second previews and shows album art from the iTunes Search
API. Apple allows that as "Promo Content" under conditions. This is what they
are, and where the app meets each one. Researched 2026-09-26. Not legal advice.

## Apple's conditions

From the iTunes Search API terms ([Apple Services Performance Partners — Search
API](https://performance-partners.apple.com/search-api); older copy at
[affiliate.itunes.apple.com](https://affiliate.itunes.apple.com/resources/documentation/itunes-store-web-service-search-api)):

1. **Only to promote the item.** Promo content may be used "for the purposes of
   promoting the subject of the Promo Content", and "is not used for independent
   entertainment value apart from its promotional purpose".
2. **Next to a link to the item in Apple's store.** It must be "proximate to a
   'Download on iTunes' or 'Download on App Store' badge (as approved by Apple)
   that acts as a link directly to" the item's page.
3. **Credit line.** Song previews must include "attribution indicating the
   Promo Content was 'provided courtesy of iTunes'".
4. **Stream only.** Previews are "streamed only, and not downloaded, saved,
   cached, or synchronized with video".

## Where the app meets them

| Condition | In the app |
|---|---|
| Credit line | Under the artist on every deck card whose preview is Apple's: "provided courtesy of iTunes" (web `.card-credit`, mobile `styles.credit`). Also in the "Hear the whole thing" sheet, and a standing note on Settings → Data & privacy. Identical in both apps. |
| Which tracks | `lib/attribution.ts` (mirrored web ↔ mobile, checked by `mobile/scripts/check-mirrors.mjs`, tested in `tests/attribution.test.ts`): chart tracks (numeric id), playlist imports matched on iTunes (`imp:itunes:<id>`), and any audio served from `*.itunes.apple.com` / `mzstatic.com`. Creator uploads (`own:…`) and Deezer imports (`imp:deezer:…`) never claim Apple's credit. |
| Link to the item | "Hear the whole thing" (the "keep listening ▸" chip in the last 5 s, or a long-press on play) lists **Apple Music** first, linking to `music.apple.com/us/song/<id>` for Apple's tracks (`appleMusicUrl`). |
| Stream only | Previews play from Apple's URL. The offline hook/sound analysers decode a preview in memory to measure it and keep only numbers (hook times, energy, a 32-byte sound profile), never the audio. |

## Badges: a text link for now

Apple's marketing artwork ("Listen on Apple Music" / iTunes badges) must be
used exactly as supplied — no redrawing, the grey border kept, minimum 25 px
tall on screen, clear space of a tenth of its height ([Apple Music Identity
Guidelines](https://marketing.services.apple/apple-music-identity-guidelines);
[iTunes identity guidelines](https://www.apple.com/itunes/marketing-on-itunes/identity-guidelines.html)).
The official SVGs come from Apple's marketing tools. They are not bundled yet,
so the store link is a plain "Apple Music ↗" text row. If Apple asks, download
the official "Listen on Apple Music" badge (SVG, black) from the marketing tools
and put it in the Apple Music row of the full-song sheet, unaltered.

## Still a judgement call

Apple's terms speak of promoting the item for sale. A discovery deck with ads
around previews is a grey area; how strictly Apple enforces this against
discovery apps is unverified. The credit and the link make the promotional
purpose visible, which is the part we control.
