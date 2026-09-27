# Hooks — how a song's playing window is chosen

A card in the deck plays a **hook**: a window into the song's audio. This is
hook recognition **v3** (September 2026). It replaced v2, which was measurably
broken.

## Why v3 exists

These numbers come from a sample of 7,900 prod hook rows across 2,961 tracks,
taken before v3:

| | v2 |
|---|---|
| hook length | 8.3–10 s (median 9.7 s) |
| tracks that replay the same seconds | **76 %** |
| neighbouring hooks that overlap | 69 % (median overlap 37 % of a hook) |
| hooks per track | 1: 115 · 2: 753 · 3: 2,093 |

v2 cut every 30 s Apple preview into three ~10 s windows, and they could
overlap by half. The "three hooks" were one hook cut into overlapping pieces,
and none of them was long enough to give you the song.

## The rules

These live in `convex/hookRules.ts`, which is pure and tested in
`tests/hook-rules.test.ts`.

- **Audio ≤ 35 s (an Apple/Deezer preview) gets exactly one hook.** It runs
  from the hook's bar to the **end of the audio** and is at least 15 s long. If
  the hook starts too late to leave 15 s, the start is pulled back to the last
  downbeat that does. There is never a fixed 10 s slice.
- **Longer audio (a creator's full upload) gets up to three distinct
  sections.** Each is 15–30 s long. Sections never overlap and are at least 5 s
  apart, and the same section label is never used twice within 45 s.
- **A person's hooks always win.** If a creator or curator has marked hooks,
  those are left alone. Only machine-made hooks are replaced. Machine-made
  means a `createdBy` of `analyzer`, `analyzer:v3:*` or `system:*`.
- **Players never replay seconds.** The web and mobile players share one
  mirrored module, `src/lib/hookPlayback.ts` (checked by
  `mobile/scripts/check-mirrors.mjs`). It does two things:
  - it drops any window that overlaps an earlier one;
  - it cuts every window at the end of the audio file.

  A single hook plays to its end; several hooks play in order.

### Where the start comes from — the policy

The admin picks the policy. It is stored as `runtime.hookPolicy` and shown in
**Config** and **Hook check**:

| value | policy | start of the hook |
|---|---|---|
| 2 (default) | **auto** | the structure model's pick when its confidence is ≥ 0.18, otherwise **0** (the whole preview, which is Apple's own excerpt) |
| 1 | heuristic | the biggest loudness lift, snapped to a bar |
| 0 | preview | always 0 |

Each hook stores the method that made it, in
`createdBy = analyzer:v3:<model|heuristic|preview|unheard>`.

## The model

`scripts/lib/hookstructure.py` does music-structure analysis with librosa. It
runs on the CPU and takes about 0.5 s per 30 s preview on this PC.

1. **Beats and bars.** It runs beat tracking, then estimates the 4/4 downbeat
   phase, so every boundary lands on a bar.
2. **Features.** It computes beat-synchronous chroma (harmony) and MFCC
   (timbre).
3. **Sections.** It builds a recurrence matrix with path enhancement, then runs
   Laplacian spectral segmentation (McFee & Ellis, ISMIR 2014). The number of
   sections is chosen by eigengap, between 2 and 5. Sections that sound alike
   share a label, so a returning chorus is one cluster.
4. **Scoring.** Each section gets a hook score:
   - loudness 0.35
   - repetition 0.35
   - entry lift 0.15
   - onset density 0.15
   - minus a penalty for short fragments
5. **Confidence.** Confidence = (winner − runner-up) × 1.5 + spread. If the
   audio has only one section, there is no model pick at all.

### Why not a deep all-in-one model?

The all-in-one structure model (`allin1`) needs NATTEN, which has no Windows
build and no AMD build, and this PC's GPU is an AMD RX 7800 XT with no CUDA. So
it can't run here.

Librosa's segmentation is the established non-neural method, and it runs
anywhere. Its limit is the input: a 30 s preview holds only one or two
sections, so there is often little structure to find. That is why:

- the policy falls back to the whole preview when the model isn't confident;
- the **Hook check** labels decide whether the model is used at all.

## Admin → Hook check

This page is for curators, and it's how we find out whether any of this works.

- **Labelling.** You listen to a random sample of 30 songs. For each song, mark
  where you hear the hook start, then rate the app's hook good or bad. The
  machine's picks stay hidden until you've marked a song, so the marks test the
  model instead of agreeing with it.
- **Evaluation.** The page compares your marks with the model, the model when
  confident, auto, the heuristic, preview-from-0, and what the app plays now.
  For each method it shows the mean absolute error and the % of songs within
  2 s.
- **Recommendation.** It recommends a policy only after 20 marks. The model has
  to beat both simpler options on mean error, and not lose on within-2 s.
  Ties go to the simpler option.
- **Apply to all songs.** This re-derives every analysed track's hooks from the
  stored analyses (`hookPlans.rematerialize`, batched) without downloading
  anything again.
- **Catalogue hook health** shows:
  - hook length distribution
  - % of songs replaying seconds (target 0 %)
  - hooks per song
  - the method mix

  The same numbers are available from the CLI: `npx convex run
  hookPlans:measureNow --prod`.

### How to label (about 10 minutes)

1. Open **Admin → Catalogue → Hook check**. If the sample is empty, press
   **draw 30 songs**.
2. Press **Space** to play from the start.
3. When the part you'd sing along to begins, press **M** on its first beat.
   That might be the chorus, the drop, or the main riff. If the preview opens
   on the hook, mark it at 0.
4. Nudge the mark with **← / →** (0.25 s; it replays from the mark).
5. The page now shows the app's hook. Press **H** to hear it, then **G** (good)
   or **B** (bad).
6. Press **N** for the next song. The dots show progress: amber means marked,
   green or red means rated.
7. After about 20 songs, the **the labels say** card and the table show which
   method wins. Press **use what the labels say** to apply it.

## Running the analyser

This is resumable and rate-limited:

```
# once: a Python 3.12 venv with the deps
python -m venv .venv-hooks
.venv-hooks/Scripts/pip install "numpy<2" scipy "librosa==0.10.2.post1" soundfile scikit-learn requests

# the key, without printing it
export HOOK_ANALYZE_KEY="$(npx convex env get HOOK_ANALYZE_KEY --prod)"

.venv-hooks/Scripts/python scripts/analyze-hooks-v3.py --limit 20        # a first look
.venv-hooks/Scripts/python scripts/analyze-hooks-v3.py                   # everything waiting
.venv-hooks/Scripts/python scripts/analyze-hooks-v3.py --dry-run --limit 20  # print plans, post nothing
```

How a run works:

- **Pending.** `/analyzer/v3/pending` lists the tracks whose `hookVersion` is
  below the current version. It is indexed, so it's cheap.
- **Resuming.** A stopped run resumes where it stopped.
- **Failures.** Audio that won't download or decode is posted as failed. The
  track gets the provisional hook and the queue moves on.
- **Ingest.** `/analyzer/v3/ingest` stores the analysis (the `hookAnalyses`
  table) and writes the hooks under the current policy. It publishes the client
  catalogue every 10 pages and at the end, not on every write.
- **New tracks.** Tracks from a chart pull, an import or a backfill start with
  **provisional** hooks until the analyser hears them (`provisionalWindows`).
  That is the whole preview, or up to three 20 s non-overlapping sections for a
  full upload.
- **New audio.** When a creator replaces their audio, `hookVersion` is reset,
  so the next run hears the new file.
- **The Node heuristic.** `scripts/lib/hook-detector.mjs` (used by
  `build-catalog.mjs` and the energy pass of `analyze-hooks.mjs`) follows the
  same rules: one ≥ 15 s hook for a preview, distinct sections for a full
  song. The old analyser's hook ingest refuses tracks v3 already owns; it still
  refreshes energy.
