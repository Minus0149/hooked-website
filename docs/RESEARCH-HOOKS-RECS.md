# Research: better hooks and better recommendations (2026-10-20)

Question from Minus: what models or methods would make HookedCue's hook
detection and song recommendations "crazy good"? ("cdms" in the request matched
no music-AI term; the search found only the CDM music blog and a production
library, so this covers models and methods generally.)

## Where the app is today

| | today | limit |
|---|---|---|
| Hook start | librosa structure analysis on the 30 s preview (docs/HOOKS.md), falls back to 0 when unsure | a preview holds 1–2 sections, so there is little structure to find |
| What a song sounds like | LAION-CLAP embedding, projected to 32 numbers (`sound`), CLAP mood + vocal readings | CLAP was the weakest of three models in one blind listening test (below) |
| Personal taste | on-device taste vector (keeps minus buries) + logistic regression on labels (predict.ts) + onboarding answers (taste.ts) | learns from 4 actions only |
| Crowd | item-item neighbours from the swipe log (recommend.ts) | silent on new songs |
| **What a swipe records** | **user, action, track** | **no listen time, no hook played, no position in the session** |

The last row is the biggest gap. Short-video feeds run on watch time; HookedCue
throws it away. "Skipped after 2 s" and "skipped after 25 s" are stored as the
same event.

## Hooks

1. **Learn hooks from listeners (crowd hooks).** Paul Lamere's "Where's the
   Drop?" (2015) located the drop in songs purely from where Spotify listeners
   scrubbed to. HookedCue already controls where playback starts, so it can do
   better than observe: keep 2–3 candidate starts per song (0, the model's pick,
   the loudness lift), deal them as a bandit (Thompson sampling), and let
   listen-time and keep-rate pick the winner per song. No new model, no GPU,
   improves with every swipe, and it measures the thing that matters (did
   people stay) rather than a proxy. Needs: listen time on each swipe and the
   hook start that was played. hooks.rerank already does the save-rate half
   for multi-hook songs.
2. **Weight the vocal line.** A 2024 study (Byron et al., *Music Perception*)
   found excerpts from the topline (the sung melody) were rated far more
   memorable than backing-track excerpts (+3.46 on the rating scale), with
   choruses and "compound hooks" adding more. The current score uses loudness,
   repetition, entry lift and onsets, with no term for "the singing starts
   here". A per-beat vocal-activity reading (CLAP vocal prompts on short
   windows, or a source separator) is a cheap new term.
3. **Full songs (creator uploads): a real structure model.**
   - *SongFormer* (ASLP-lab, Oct 2025) is the current state of the art:
     beats All-In-One and Gemini 2.5 Pro at finding section boundaries and
     labelling choruses (SongFormBench-Harmonix accuracy 0.807 vs 0.740).
     **But it runs on MuQ, whose weights are CC BY-NC 4.0, so it is not
     usable in a product with ads and paid promotions.** An INT8 ONNX build
     exists, also non-commercial.
   - *All-In-One* (Kim & Nam 2023) is MIT-licensed. It was blocked here only
     by NATTEN (no Windows/AMD build); an ONNX conversion of its 8-fold
     ensemble now runs on CPU, even in a browser (`azstorm/lightcut-music-
     analysis-models`), for 76–660 s audio. Fits creator uploads, not
     previews.
   - Apple's preview is already Apple's own pick of the song, usually around
     the chorus, which is why "start at 0" stays competitive on previews. Deep
     structure models help full songs far more than 30 s clips.
4. **Measure before switching.** Admin → Hook check already compares methods
   against hand labels. It needs about 20 labelled songs to recommend anything.

## Recommendations

1. **Record listen time** (same change as hooks #1). It turns four actions
   into a graded signal (skip at 2 s = strong no; skip at 25 s = mild yes) and
   lets every model below learn faster. This is the standard implicit-feedback
   signal in feed recommenders.
2. **An offline evaluation harness before any model swap.** Replay the swipe
   log: hide each listener's later keeps, rank the catalogue with each method
   (CLAP sound, labels model, neighbours, the blend), and measure hit-rate@10.
   Without it, "better" is a guess. Every item below should be judged by it.
3. **A better "sounds like" model, if the harness says so.**
   - Commercial-use licences: OpenL3 (code MIT, weights CC BY 4.0) and
     LAION-CLAP (Apache 2.0).
   - Non-commercial: MuQ / MuQ-MuLan, MERT, MusicFM-based stacks, and all of
     Essentia's models incl. Discogs-EffNet (CC BY-NC-SA; a commercial licence
     is available from UPF on request).
   - One open project's blind listening test (`whepper/musicpack`) ranked
     Discogs-EffNet best, OpenL3 second and LAION-CLAP last for "sounds
     similar". A 2026 study of nine pretrained models for recommendation found
     their MIR-benchmark ranking does not carry over to recommendation, which
     is why the harness has to decide, not the leaderboard.
4. **Exploration on purpose.** A bandit over catalogue regions (language ×
   mood × sound cluster) so the deck keeps testing a little outside the taste
   vector, gets new songs heard, and stops a filter bubble forming early.
5. **Session drift.** Weight the last few swipes more than the last few weeks
   (exponential decay on the taste vector). Moods change within a sitting.
6. **Later, at scale.** Sequence models (SASRec, BERT4Rec) and two-tower
   retrieval need logs in the hundreds of thousands of events; predict.ts
   already explains why they would lose to the linear model today.
7. **"Describe a vibe" search.** CLAP embeds text and audio in the same space,
   so a typed vibe ("late-night drive, Hindi") can be matched against the
   `sound` vectors already stored. The text encoder has to run somewhere
   (a precomputed set of vibes avoids that).

## Sources

- SongFormer: github.com/ASLP-lab/SongFormer; arXiv 2510.02797
- SongFormer ONNX (non-commercial): huggingface.co/akineAItech/CUE-Uttaro-SongFormer-ONNX
- All-In-One: github.com/mir-aidj/all-in-one (MIT); ONNX: huggingface.co/azstorm/lightcut-music-analysis-models
- Where's the Drop?: cdm.link/wheres-drop-web-app-creepily-knows-via-crowd (2015)
- Byron, Rushworth & Stewart (2024), *Music Perception*, doi 10.1525/mp.2024.2322897
- CloserMusicDB hook annotations: arXiv 2410.19540 (MSAF found annotated hooks 41.5 % within ±5 s)
- Essentia model licensing: essentia.upf.edu/models.html, essentia.upf.edu/licensing_information.html
- Embedding comparison: github.com/whepper/musicpack (specs/musicpack-sonic-v1.md)
- Pretrained audio representations for recommenders (2026): pubdb.com/paper/2604.23077

## Calibrated decision models (CDMs) and Jev — added 2026-10-20

"jev" and "cdms" in the request: **Jev** is TypeSafe AI's model (released
2026-09-15, proprietary, hosted, early access). It never generates text: it
reads a `state` and answers typed questions (Choice of up to 255 options, Score
on a rubric, yes/no) with calibrated probabilities, in ~70–500 ms, at
$0.042 per million input tokens (output free). **Calibrated decision models**
is the name used for this class (Victor Dibia's explainer, Sep 2026).

- **Text only.** Jev's docs: "Images, audio, and video are not supported
  (yet)." So it cannot hear a hook. For hooks it can only choose between
  features we compute, which the analyser already does; crowd hooks (above)
  remain the better route.
- **Catalogue tagging (best fit).** Language, cover/sped-up/remix, mood from
  title + artist + album; act only above ~95 % confidence, queue the rest for
  Admin. ~2,400 tracks × ~150 tokens ≈ 0.4 M tokens ≈ $0.02 on Jev, or free on
  the local Qwen3.8-27B (arXiv 2609.37647: Jev beat Qwen3.8-27B on 27 of 37
  datasets, none of Qwen's 9 leads outside the bootstrap intervals).
- **Reranking the next cards.** State = recent swipes as text; Choice over
  20–100 retrieved candidates. Cheng Luo's study (Sep 2026, Jev-style scorer
  on Qwen3, MovieLens): ties SASRec in-domain at 8B, but on unseen movies
  0.555 vs 0.253 HR@1 — the cold-start case the nightly chart pull creates.
  Costs: listening history goes to a US vendor (privacy policy + Play data
  safety), ~0.1–0.5 s per call (prefetch), roughly $25/month at 10k
  calls/day, early-access dependency.
- **Independent caveats.** TypedBench (arXiv 2610.11392): the hosted model is
  wording-sensitive and underconfident. sys1bench (2026-09-22): Jev
  overconfident on Score questions; wording alone moved one task from 0.39
  to 0.53 accuracy.
- **Open-weight alternatives.** Laya (Convai Innovations, Apache 2.0,
  ModernBERT 421M / mmBERT 322M, CPU 193–464 ms per question): near chance
  zero-shot until fine-tuned, collapses on Devanagari and long option lists.
  kev (Jared Palmer, Qwen3.5 0.8B/4B base): ~20 % of answers flipped when
  options were reordered.

Sources: typesafe.ai/blog/introducing-system-one-models-and-jev;
docs.typesafe.ai/concepts/system-one; docs.typesafe.ai/models;
victordibia.com/explainers/jev; arxiv.org/html/2609.37647v1;
arxiv.org/html/2610.11392; wdlctc.github.io/jev-recommend.html;
systemonemodels.org/models/laya; huggingface.co/marcmagn1/kev-08b-typed-v1;
pypi.org/project/sys1bench.
