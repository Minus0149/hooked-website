# To do

Things Minus asked for that aren't built yet. Newest first.

## 27 Oct 2026 — after the hook fix

### When a hook ends: a setting
Right now a single hook plays to the end of its window. Let the listener choose, in Settings:
- **Loop the hook** until they swipe.
- **Next song** automatically.
- **Keep playing** the rest of the clip.

Pick one as the default after testing it with real listeners.

### Share and listen together
- **Share a song to a friend:** a link that opens the song at its hook. Works for people without the app.
- **Share to followers:** post a song to your followers inside HookedCue.
- **Play together:** two or more people swipe the same deck at the same time and see each other's saves.
- **Similar ideas** from Minus's list to work out later: other ways to discover with friends.

Notes:
- These need accounts that can follow each other. Check what `convex/` already has for follows and profiles before designing.
- Sharing a hook link must respect the iTunes preview terms (`docs/ITUNES-ATTRIBUTION.md`).

## Hook coverage (shipped 27 Oct 2026, commit d7432ee)
- Rule: auto falls back to the heuristic (never 0). The window opens 1.5–3.5 s before the hook and ends on the last whole 2-bar line in the clip, at least 12 s. Web fades out over the last 0.5 s (Minus, 27 Oct).
- Deployed to Convex prod. The 4,292 analysed tracks are re-planned. The analyser backlog (8,932) is running from this PC.
- **Phone app:** `hookGain` is mirrored in `mobile/src/lib/hookPlayback.ts` but the phone player doesn't call it yet. Add the volume ramp to the expo-audio player and ship a Play build. Until then, phones stop at the line's end without the fade.
- Limit to remember: Apple's preview is 30 s. If the hook line isn't inside it (e.g. "Gehra Hua"), no rule can reach it. Deezer returns nothing from India.
