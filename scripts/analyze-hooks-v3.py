"""
Hook recognition v3 — listen to every track and post its structure.

    python scripts/analyze-hooks-v3.py [--base https://<deployment>.convex.site]
                                       [--limit N] [--workers 3] [--delay 0.25]
                                       [--dry-run]

Needs HOOK_ANALYZE_KEY in the environment (npx convex env get HOOK_ANALYZE_KEY)
and ffmpeg on PATH; Python deps: numpy<2, scipy, librosa 0.10, scikit-learn,
requests (see docs/HOOKS.md). CPU only — about half a second per preview.

It pulls tracks the current pipeline hasn't heard from /analyzer/v3/pending,
downloads each preview (or a creator's full upload), runs
scripts/lib/hookstructure.py, and posts the ANALYSIS (sections, downbeats,
confidence, the model's and the heuristic's picks) to /analyzer/v3/ingest. The
server turns it into hooks under the admin's policy (convex/hookRules.ts).

Resumable by construction: the server stamps each track as it's ingested, so
a stopped run picks up where it left off. Audio that can't be fetched or
decoded is posted as failed — the track gets the provisional whole-preview
hook and the queue moves on instead of retrying it forever.

Rate-limited on purpose: a few workers and a pause per download keep this a
polite client of Apple's preview CDN and of the Convex free plan.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import hookstructure as hs  # noqa: E402

UA = "hookedcue-hook-analyser/3 (+https://hookedcue.com)"


def payload(a: hs.Analysis) -> dict:
    ms = lambda s: int(round(s * 1000))  # noqa: E731
    return {
        "durationMs": ms(a.duration),
        "tempo": round(float(a.tempo), 2) if a.tempo else None,
        "downbeatsMs": [ms(d) for d in a.downbeats][:600],
        "sections": [
            {"startMs": ms(s.start), "endMs": ms(s.end), "label": int(s.label), "score": round(float(s.score), 4)}
            for s in a.sections
        ][:60],
        "modelStartMs": None if a.model_start is None else ms(a.model_start),
        "confidence": round(float(a.confidence), 4),
        "heuristicStartMs": ms(a.heuristic_start),
    }


def listen(track: dict, delay: float) -> dict:
    """One track → an ingest item (an analysis, or failed), or a retry later.

    Only a permanent problem (no URL, a 4xx, audio that won't decode) is posted
    as failed. A timeout, a dropped connection or a 5xx/429 is skipped, so the
    track stays in the queue and the next run hears it.
    """
    tid = track["trackId"]
    url = track.get("url")
    if not url:
        return {"trackId": tid, "failed": True, "why": "no url"}
    try:
        time.sleep(delay)
        r = requests.get(url, timeout=30, headers={"User-Agent": UA})
        if r.status_code == 429 or r.status_code >= 500:
            return {"trackId": tid, "retry": True, "why": f"HTTP {r.status_code}"}
        r.raise_for_status()
        y = hs.decode(r.content)
        if y.size < hs.SR * 2:
            return {"trackId": tid, "failed": True, "why": "too short to hear"}
        a = hs.analyse(y)
        item = {"trackId": tid, "analysis": {k: v for k, v in payload(a).items() if v is not None}}
        item["_plan"] = hs.plan(a)
        return item
    except (requests.ConnectionError, requests.Timeout) as e:
        return {"trackId": tid, "retry": True, "why": f"{type(e).__name__}: {str(e)[:120]}"}
    except Exception as e:  # noqa: BLE001 — one bad file never stops the run
        return {"trackId": tid, "failed": True, "why": f"{type(e).__name__}: {str(e)[:120]}"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://shocking-goldfinch-745.convex.site")
    ap.add_argument("--limit", type=int, default=0, help="stop after N tracks (0 = all)")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--delay", type=float, default=0.25, help="seconds each worker waits per download")
    ap.add_argument("--page", type=int, default=48)
    ap.add_argument("--dry-run", action="store_true", help="analyse and print, post nothing")
    args = ap.parse_args()

    key = os.environ.get("HOOK_ANALYZE_KEY", "")
    if not key:
        print("HOOK_ANALYZE_KEY is not set", file=sys.stderr)
        return 2
    base = args.base.rstrip("/")
    s = requests.Session()
    s.headers.update({"x-analyzer-key": key, "User-Agent": UA})

    done = 0
    methods: dict[str, int] = {}
    failed = 0
    seen: set[str] = set()
    t0 = time.time()
    pages = 0

    def publish() -> None:
        # one catalogue rebuild for everything posted so far (see hookPlans.touch)
        if not args.dry_run:
            s.post(f"{base}/analyzer/v3/ingest", data=json.dumps({"batch": [], "touch": True}), timeout=60,
                   headers={"content-type": "application/json"}).raise_for_status()

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        while True:
            want = args.page if not args.limit else min(args.page, args.limit - done)
            if want <= 0:
                break
            r = s.get(f"{base}/analyzer/v3/pending", params={"limit": want}, timeout=60)
            r.raise_for_status()
            tracks = [t for t in r.json().get("tracks", []) if t["trackId"] not in seen]
            if not tracks:
                break
            for t in tracks:
                seen.add(t["trackId"])
            items = list(pool.map(lambda t: listen(t, args.delay), tracks))
            retry = [it for it in items if it.get("retry")]
            for it in retry:
                print(f"  later {it['trackId']}: {it.get('why')}", flush=True)
            items = [it for it in items if not it.get("retry")]
            for it in items:
                if it.get("failed"):
                    failed += 1
                    print(f"  unheard {it['trackId']}: {it.get('why')}", flush=True)
                else:
                    m = it["_plan"]["method"]
                    methods[m] = methods.get(m, 0) + 1
            if args.dry_run:
                for it, t in zip(items, tracks):
                    if not it.get("failed"):
                        p = it["_plan"]
                        wins = ", ".join(f"{a:.1f}+{b:.1f}s" for a, b in p["windows"])
                        print(f"  {t.get('title', '')[:32]:32} {p['method']:9} {wins}")
            else:
                body = [{k: v for k, v in it.items() if not k.startswith("_") and k != "why"} for it in items]
                for i in range(0, len(body), 24):
                    chunk = body[i : i + 24]
                    for attempt in range(4):
                        pr = s.post(f"{base}/analyzer/v3/ingest", data=json.dumps({"batch": chunk, "touch": False}), timeout=120,
                                    headers={"content-type": "application/json"})
                        if pr.status_code < 500:
                            break
                        time.sleep(2 ** attempt)
                    pr.raise_for_status()
                    bad = [x for x in pr.json().get("results", []) if not x.get("ok")]
                    for x in bad:
                        print(f"  rejected {x.get('trackId')}: {x.get('reason')}", flush=True)
            done += len(items) + len(retry)
            pages += 1
            if pages % 10 == 0:
                publish()
            rate = done / max(time.time() - t0, 1e-6)
            print(f"{done} heard · {failed} unheard · {methods} · {rate:.1f}/s", flush=True)
            if args.dry_run:
                break  # nothing was stamped, so the next page would be the same tracks
    publish()
    print(f"finished: {done} tracks in {time.time() - t0:.0f}s · methods {methods} · unheard {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
