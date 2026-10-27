# To do

Things Minus asked for that aren't built yet. Newest first.

## Still to do

### Social features on the phone app
The web app has them (below). The phone app (`mobile/`) needs the same screens: People, someone's profile, the mutual playlist, shared playlists and invite links, rooms, "Share to followers" in the song sheet, and the "When a hook ends" setting in its player. Then a Play build.

### Measure whether the deck is working
Nothing yet records:
- day-1 and day-7 return
- session length and swipes per session
- the save rate of what each ranking layer suggested (onboarding taste, the on-device model, "people who saved this also saved")

`recommend.rebuild` runs every 6 h but publishes nothing until at least 3 people have reacted to the same songs. Production had 14 swipes from 2 listeners on 28 Oct.

## Audit 28 Oct 2026 (web, local commits, nothing deployed)
- **Deploy, in this order:** `npx convex deploy -y` (prod: ConvexError refusals, social fixes, auth rate limits; schema unchanged), then the web app (Dokploy). Until both ship, prod still redacts every refusal to "Server Error", so a new account that hasn't confirmed its email sees the app with nothing syncing instead of "check your inbox".
- Caddyfile now sends `X-Robots-Tag: noindex` on app screens; only `/` is indexable.
- **Phone app needs the same:** read `err.data` (ConvexError) instead of `err.message`; Home "Because you wanted more" rows must skip blocked artists, buried and kept songs; the room join must wait for auth.
- **Open:** per-playlist share cards (a `hookedcue.com/p/<id>` page like `/s/<id>`, plus a public-playlist card query); better-auth major upgrade for the remaining npm audit items; 981 of 6,377 prod tracks still play from 0 until the hook analyser backlog finishes.

## Social + when a hook ends (built 28 Oct 2026, web)
- **When a hook ends** (Settings → Playback): next song (the default, as before), loop the hook, or keep playing the rest of the clip. Synced to the account. `convex/socialRules.ts` `afterHookAction`, wired in `src/audio/usePlayer.ts`.
- **People** (`/people`): find people by @username, follow and unfollow, followers and following lists, and someone's page at `/u/<username>`.
- **Share to followers**: from a song's sheet (hold the play button), with an optional note (140 characters, no links). It shows on followers' Home ("Friends" card) and in People.
- **Mutual playlist** (`/u/<username>/mutual`): unlocks when two people follow each other. It lists the songs both saved first, then alternates picks from each side.
- **Shared playlists**: owners mark a playlist Public (it shows on their profile and opens for anyone signed in) and/or Collaborative. The invite link `/join-playlist/<code>` lets friends join. Members' saves land in it when it's their swipe-down target, and the page updates live. A song can be removed by the owner or by whoever added it.
- **Play together** (`/together/<code>`): the host opens a room on their next 40 songs. Everyone hears the same song, sees who's in the room, and sees each other's saves live. The host's Next or the song's end moves everyone on. Rooms close when the host ends them or after 6 h idle.
- **Account deletion** removes follows both ways, posts, memberships (theirs and others' in their playlists), hosted rooms and room activity.
- **Tested:** `tests/social.test.ts` (18 cases). Driven end to end on the dev deployment with two test accounts. Every step passed: follow, share, feed, collaborative join and add, mutual, room sync, live saves, Next, and the setting kept after a reload.
- **Not in production yet:** run `npx convex deploy` (schema is additive) and deploy the web app. Production has had no social data until then.

## Hook coverage (shipped 27 Oct 2026, commit d7432ee)
- Rule: auto falls back to the heuristic (never 0). The window opens 1.5–3.5 s before the hook and ends on the last whole 2-bar line in the clip, at least 12 s. Web fades out over the last 0.5 s (Minus, 27 Oct).
- Deployed to Convex prod. The 4,292 analysed tracks are re-planned. The analyser backlog (8,932) is running from this PC.
- **Phone app:** `hookGain` is mirrored in `mobile/src/lib/hookPlayback.ts` but the phone player doesn't call it yet. Add the volume ramp to the expo-audio player and ship a Play build. Until then, phones stop at the line's end without the fade.
- Limit to remember: Apple's preview is 30 s. If the hook line isn't inside it (e.g. "Gehra Hua"), no rule can reach it. Deezer returns nothing from India.
