"""
Hook recognition v3 — music structure analysis of a preview (or a full song).

What it does, in MIR terms (librosa; no GPU needed):
  1. Beat tracking, then a 4/4 downbeat phase estimate (the beat phase whose
     every-4th onset strength is highest), so every boundary lands on a bar.
  2. Beat-synchronous chroma (harmony) + MFCC (timbre) features.
  3. A recurrence (self-similarity) matrix with path enhancement, and
     Laplacian spectral segmentation (McFee & Ellis, "Analyzing song structure
     with spectral clustering", ISMIR 2014): sections that sound alike share a
     label, so a chorus that comes back is one cluster.
  4. Each section is scored as "the hook" from what choruses are made of:
     loudness relative to the rest, repetition (how much of the audio shares
     its label / resembles it), an entry lift (it arrives louder than what was
     before), and density (onsets), with short fragments penalised.
  5. Confidence = how clearly the winner beats the runner-up, discounted when
     the audio barely has structure (one section, or everything the same).

plan() turns that into hook windows:
  - audio <= 35 s (an Apple preview): exactly ONE hook. Confident → from the
    chosen section's downbeat to the end of the audio, pulled earlier to a bar
    if that would leave under MIN_HOOK_S. Not confident → the whole preview
    from 0 (Apple's own excerpt). Never a fixed 10 s slice.
  - longer audio (a creator's full upload): up to 3 hooks, each a DISTINCT
    section (different label or far apart), no overlap, each >= MIN_HOOK_S.

Also returns a no-model heuristic start (loudness lift, beat-snapped) so the
admin "Hook check" can measure which method matches a human best.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass, field

import numpy as np

SR = 22050
HOP = 512
MIN_HOOK_S = 15.0
PREVIEW_MAX_S = 35.0
MAX_HOOKS_LONG = 3
CONFIDENT = 0.18  # confidence at or above which the model's pick is used

VERSION = 3


def decode(data: bytes, sr: int = SR) -> np.ndarray:
    """Any container ffmpeg reads -> mono float32 at sr. Empty on failure."""
    p = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", str(sr), "-f", "f32le", "pipe:1"],
        input=data, capture_output=True, timeout=60,
    )
    if p.returncode != 0:
        return np.zeros(0, dtype=np.float32)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


@dataclass
class Section:
    start: float
    end: float
    label: int
    loud: float = 0.0
    repeat: float = 0.0
    lift: float = 0.0
    density: float = 0.0
    score: float = 0.0

    @property
    def dur(self) -> float:
        return self.end - self.start


@dataclass
class Analysis:
    duration: float
    tempo: float
    downbeats: list[float]
    sections: list[Section]
    model_start: float | None
    confidence: float
    heuristic_start: float
    notes: list[str] = field(default_factory=list)


def _norm(v: np.ndarray) -> np.ndarray:
    lo, hi = float(np.min(v)), float(np.max(v))
    return (v - lo) / (hi - lo) if hi - lo > 1e-9 else np.full_like(v, 0.5)


def _snap(t: float, grid: list[float], lo: float = 0.0, hi: float | None = None) -> float:
    cands = [g for g in grid if g >= lo and (hi is None or g <= hi)]
    if not cands:
        return t
    return float(min(cands, key=lambda g: abs(g - t)))


def analyse(y: np.ndarray, sr: int = SR) -> Analysis:
    import librosa
    import scipy.ndimage
    import scipy.sparse.csgraph
    import scipy.linalg
    from sklearn.cluster import KMeans  # noqa: F401  (librosa ships sklearn dep)

    duration = len(y) / sr
    notes: list[str] = []
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=HOP, trim=False)
    tempo = float(np.atleast_1d(tempo)[0])
    beat_t = librosa.frames_to_time(beats, sr=sr, hop_length=HOP)
    if len(beats) < 16:
        notes.append("too few beats for structure")
        return Analysis(duration, tempo, [0.0], [Section(0.0, duration, 0)], None, 0.0, 0.0, notes)

    # downbeat phase: the beat offset (0..3) whose every-4th onset energy is highest
    strength = onset[np.clip(beats, 0, len(onset) - 1)]
    phase = int(np.argmax([strength[p::4].mean() for p in range(4)]))
    downbeats = [float(t) for t in beat_t[phase::4]]
    if downbeats[0] > 0.05:
        downbeats = [0.0] + downbeats

    # beat-synchronous features
    C = librosa.amplitude_to_db(np.abs(librosa.cqt(y=y, sr=sr, hop_length=HOP, bins_per_octave=36, n_bins=252)), ref=np.max)
    Csync = librosa.util.sync(C, beats, aggregate=np.median)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP, n_mfcc=13)
    Msync = librosa.util.sync(mfcc, beats)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    Rsync = librosa.util.sync(rms[None, :], beats)[0]
    Osync = librosa.util.sync(onset[None, :], beats)[0]

    # recurrence + path enhancement (McFee & Ellis 2014)
    R = librosa.segment.recurrence_matrix(Csync, width=3, mode="affinity", sym=True)
    df = librosa.segment.timelag_filter(scipy.ndimage.median_filter)
    Rf = df(R, size=(1, 7))
    path_distance = np.sum(np.diff(Msync, axis=1) ** 2, axis=0)
    sigma = np.median(path_distance) or 1.0
    path_sim = np.exp(-path_distance / sigma)
    R_path = np.diag(path_sim, k=1) + np.diag(path_sim, k=-1)
    deg_path = np.sum(R_path, axis=1)
    deg_rec = np.sum(Rf, axis=1)
    mu = deg_path.dot(deg_path + deg_rec) / (np.sum((deg_path + deg_rec) ** 2) or 1.0)
    A = mu * Rf + (1 - mu) * R_path
    L = scipy.sparse.csgraph.laplacian(A, normed=True)
    evals, evecs = scipy.linalg.eigh(L)
    evecs = scipy.ndimage.median_filter(evecs, size=(9, 1))
    Cnorm = np.cumsum(evecs ** 2, axis=1) ** 0.5

    # choose k by the eigengap among 2..5 clusters
    ks = range(2, min(6, A.shape[0] // 8 + 2))
    gaps = {k: float(evals[k] - evals[k - 1]) for k in ks if k < len(evals)}
    k = max(gaps, key=gaps.get) if gaps else 2
    X = evecs[:, :k] / (Cnorm[:, k - 1:k] + 1e-9)
    from sklearn.cluster import KMeans
    labels = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(X)

    # contiguous runs of a label -> sections, boundaries snapped to bars
    bounds = [0] + [i for i in range(1, len(labels)) if labels[i] != labels[i - 1]] + [len(labels)]
    sections: list[Section] = []
    for a, b in zip(bounds, bounds[1:]):
        st = float(beat_t[a]) if a < len(beat_t) else duration
        en = float(beat_t[b]) if b < len(beat_t) else duration
        st = _snap(st, downbeats, hi=duration - 1) if a > 0 else 0.0
        sections.append(Section(st, en, int(labels[a])))
    # merge fragments shorter than 3 s into their neighbour
    merged: list[Section] = []
    for s in sections:
        if merged and (s.dur < 3.0 or s.start - merged[-1].start < 3.0):
            merged[-1].end = s.end
        else:
            merged.append(s)
    for i in range(len(merged) - 1):
        merged[i].end = merged[i + 1].start
    merged[-1].end = duration
    sections = [s for s in merged if s.dur > 0.5]

    # score sections
    bt = np.append(beat_t, duration)
    def beat_slice(s: Section) -> slice:
        i0 = int(np.searchsorted(bt, s.start)); i1 = max(i0 + 1, int(np.searchsorted(bt, s.end)))
        return slice(i0, min(i1, len(Rsync)))

    loud = np.array([float(np.mean(librosa.amplitude_to_db(Rsync[beat_slice(s)] + 1e-6))) for s in sections])
    dens = np.array([float(np.mean(Osync[beat_slice(s)])) for s in sections])
    lab_time = {}
    for s in sections:
        lab_time[s.label] = lab_time.get(s.label, 0.0) + s.dur
    rep = []
    for s in sections:
        sl = beat_slice(s)
        within = Rf[sl, :]
        outside = np.concatenate([within[:, : sl.start], within[:, sl.stop :]], axis=1) if within.size else np.zeros((1, 1))
        rep.append(0.5 * (lab_time[s.label] - s.dur) / max(duration, 1.0) + 0.5 * float(outside.mean() if outside.size else 0.0))
    rep = np.array(rep)
    lift = np.array([0.0] + [loud[i] - loud[i - 1] for i in range(1, len(sections))])
    ln, rn, dn, fn = _norm(loud), _norm(rep), _norm(dens), _norm(lift)
    for i, s in enumerate(sections):
        s.loud, s.repeat, s.density, s.lift = float(ln[i]), float(rn[i]), float(dn[i]), float(fn[i])
        short = 0.35 if s.dur < 6 else (0.12 if s.dur < 9 else 0.0)
        s.score = 0.35 * s.loud + 0.35 * s.repeat + 0.15 * s.lift + 0.15 * s.density - short

    ranked = sorted(sections, key=lambda s: s.score, reverse=True)
    if len(sections) < 2:
        confidence, model_start = 0.0, None
        notes.append("one section: no structure to choose from")
    else:
        margin = ranked[0].score - ranked[1].score
        spread = float(np.std([s.score for s in sections]))
        confidence = float(max(0.0, min(1.0, margin * 1.5 + spread)))
        model_start = ranked[0].start

    # no-model heuristic: largest 2 s loudness lift, snapped to a downbeat
    frames_per_s = sr / HOP
    rdb = librosa.amplitude_to_db(rms + 1e-6)
    w = int(2 * frames_per_s)
    lifts = [(np.mean(rdb[i:i + w]) - np.mean(rdb[max(0, i - w):i]), i) for i in range(w, max(w + 1, len(rdb) - w), int(frames_per_s / 2))]
    h_t = (max(lifts)[1] / frames_per_s) if lifts else 0.0
    heuristic_start = _snap(h_t, downbeats, hi=max(0.0, duration - MIN_HOOK_S))

    return Analysis(duration, tempo, downbeats, sections, model_start, confidence, heuristic_start, notes)


def single_window(start: float, duration: float, downbeats: list[float]) -> tuple[float, float]:
    """One hook from start to the end of the audio, at least MIN_HOOK_S long."""
    if duration <= MIN_HOOK_S:
        return 0.0, duration
    latest = duration - MIN_HOOK_S
    if start > latest:
        start = max([d for d in downbeats if d <= latest] or [0.0])
    return float(start), float(duration - start)


def plan(a: Analysis, policy: str = "auto") -> dict:
    """Hook windows for one track. policy: auto | heuristic | preview."""
    d = a.duration
    if d <= PREVIEW_MAX_S:
        if policy == "preview":
            method, start = "preview", 0.0
        elif policy == "heuristic":
            method, start = "heuristic", a.heuristic_start
        elif a.model_start is not None and a.confidence >= CONFIDENT:
            method, start = "model", a.model_start
        else:
            method, start = "preview", 0.0
        s, ln = single_window(start, d, a.downbeats)
        return {"method": method, "windows": [(s, ln)]}

    # long audio: up to 3 distinct sections, no overlap
    if policy == "preview" or not a.sections or a.confidence < CONFIDENT:
        s, ln = single_window(a.heuristic_start if policy == "heuristic" else 0.0, d, a.downbeats)
        return {"method": "heuristic" if policy == "heuristic" else "preview", "windows": [(s, min(ln, 30.0))]}
    picked: list[tuple[float, float]] = []
    used_labels: set[int] = set()
    for sec in sorted(a.sections, key=lambda s: s.score, reverse=True):
        if len(picked) >= MAX_HOOKS_LONG:
            break
        length = min(max(sec.dur, MIN_HOOK_S), 30.0)
        start, end = sec.start, min(sec.start + length, d)
        if end - start < MIN_HOOK_S:
            continue
        far = all(start >= pe + 5.0 or end <= ps - 5.0 for ps, pe in picked)
        if not far:
            continue
        if sec.label in used_labels and any(abs(start - ps) < 45 for ps, _ in picked):
            continue
        picked.append((start, end))
        used_labels.add(sec.label)
    if not picked:
        s, ln = single_window(0.0, d, a.downbeats)
        return {"method": "preview", "windows": [(s, min(ln, 30.0))]}
    return {"method": "model", "windows": [(s, e - s) for s, e in picked]}
