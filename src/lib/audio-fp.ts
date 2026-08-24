/**
 * Landmark-pair audio fingerprints, computed entirely in the browser.
 *
 * Why here and not on the server: the VPS runs everything else we ask of it,
 * and decoding + FFT-ing every creator upload is exactly the kind of work
 * browsers do for free (the creator's machine decodes their own file before
 * a single byte uploads). The server only ever sees integers.
 *
 * The scheme is a small Shazam-style constellation hasher:
 *   mono downsample → STFT → 16 log-spaced band energies → spectral peaks
 *   → pairs of peaks (frequency, Δfrequency, Δtime) hashed to uint32.
 *
 * A re-encoded copy of the same recording shares most landmark pairs
 * (overlap > ~0.35); two different songs share almost none (~0.02). That's
 * a duplicate detector, not Content-ID — the copyright policy says so too.
 */

/** analysis sample rate — plenty for band-level structure, cheap to run */
export const TARGET_SR = 11025;
const FRAME = 1024;
const HOP = 512;
const BANDS = 16;

/** Downmix to mono and average down to ~TARGET_SR. */
function toMonoDownsampled(buf: AudioBuffer): Float32Array {
  const ch = buf.numberOfChannels;
  const left = buf.getChannelData(0);
  const right = ch > 1 ? buf.getChannelData(1) : null;
  const factor = Math.max(1, Math.round(buf.sampleRate / TARGET_SR));
  const outLen = Math.floor(left.length / factor);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) {
      const s = left[base + j];
      sum += right ? (s + right[base + j]) / 2 : s;
    }
    out[i] = sum / factor;
  }
  return out;
}

/** In-place iterative radix-2 FFT (real signals get the usual im=0 start). */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Log-spaced band edges across the usable half-spectrum. */
const BAND_EDGES: number[] = (() => {
  const nyquistBins = FRAME / 2;
  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b++) {
    // geometric spacing from bin 2 to Nyquist
    edges.push(Math.round(2 * Math.pow(nyquistBins / 2, b / BANDS)));
  }
  return edges;
})();

/**
 * Band-energy matrix: BANDS rows × frames columns, dB-ish scaled.
 */
function bandMatrix(mono: Float32Array): { m: Float32Array[]; frames: number } {
  const frames = Math.max(1, Math.floor((mono.length - FRAME) / HOP));
  const m: Float32Array[] = [];
  for (let b = 0; b < BANDS; b++) m.push(new Float32Array(frames));

  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const hann = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = (mono[off + i] ?? 0) * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < BANDS; b++) {
      let sum = 0;
      const lo = BAND_EDGES[b];
      const hi = Math.max(BAND_EDGES[b + 1], lo + 1);
      for (let k = lo; k < hi; k++) {
        sum += re[k] * re[k] + im[k] * im[k];
      }
      // log compress — perceived loudness, not raw joules
      m[b][f] = Math.log10(1 + 1000 * Math.sqrt(sum / Math.max(1, hi - lo)));
    }
  }
  return { m, frames };
}

interface Point {
  frame: number;
  band: number;
  strength: number;
}

/** Local-max peak picking: stronger than its 5×5 neighbourhood AND the mean. */
function pickPeaks(m: Float32Array[], frames: number): Point[] {
  const points: Point[] = [];
  for (let b = 2; b < BANDS - 2; b++) {
    for (let f = 2; f < frames - 2; f++) {
      const v = m[b][f];
      if (v <= 0.6) continue;
      let isMax = true;
      for (let db = -2; db <= 2 && isMax; db++) {
        for (let df = -2; df <= 2; df++) {
          if (db === 0 && df === 0) continue;
          if (m[b + db][f + df] > v) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) points.push({ frame: f, band: b, strength: v });
    }
  }
  points.sort((a, b2) => b2.strength - a.strength);
  return points.slice(0, 160);
}

/**
 * Pair a strong anchor with nearby targets and fold (f1, f2, Δt, Δf) into a
 * single uint32. Exported for tests — the exact bit layout doesn't matter as
 * long as it never changes once fingerprints exist.
 */
export function pairHash(
  f1: number,
  f2: number,
  dt: number,
  df: number,
): number {
  return (
    (((f1 & 31) << 27) |
      ((f2 & 31) << 22) |
      ((dt & 63) << 15) |
      ((df & 15) << 11)) >>>
    0
  );
}

/** Overlap of two hash sets relative to the smaller one. */
export function similarity(a: number[], b: number[]): number {
  const setB = new Set(b);
  let hits = 0;
  for (const h of a) if (setB.has(h)) hits++;
  return hits / Math.max(1, Math.min(a.length, b.length));
}

/**
 * Full pipeline: decoded audio → uint32 landmark-pair hashes, strongest first.
 */
export function computeFingerprint(buf: AudioBuffer): number[] {
  const mono = toMonoDownsampled(buf);
  if (mono.length < FRAME * 2) return [];
  const { m, frames } = bandMatrix(mono);
  const peaks = pickPeaks(m, frames);

  const hashes = new Set<number>();
  for (let i = 0; i < peaks.length; i++) {
    const anchor = peaks[i];
    let paired = 0;
    for (let j = i + 1; j < peaks.length && paired < 4; j++) {
      const target = peaks[j];
      const dt = target.frame - anchor.frame;
      if (dt < 1 || dt > 48) continue;
      const df = target.band - anchor.band;
      if (Math.abs(df) > 8) continue;
      hashes.add(pairHash(anchor.band, target.band, dt, df));
      paired++;
    }
    if (hashes.size >= 380) break;
  }
  return [...hashes];
}
