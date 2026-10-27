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

## Hook coverage (in progress)
- Every song should start at its hook. As of 27 Oct, 8,952 of 13,244 tracks hadn't been analysed and still played the whole 30 s clip.
- The rule changed (`convex/hookRules.ts`): auto now falls back to the heuristic, never to 0, and adds a 2–3 s build-up.
- A 20-song dry run is waiting for Minus's ears (`.tmp/hook-test/listen.html`).
- Next steps after his OK:
  1. Deploy the Convex functions.
  2. Run `scripts/analyze-hooks-v3.py` on the backlog.
  3. Run "Apply to all songs" for the 4,292 already analysed.
