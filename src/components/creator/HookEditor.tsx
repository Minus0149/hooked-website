import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PEAKS = 480;

/**
 * Waveform hook editor.
 *
 * Hook starts used to be typed into a "start (s)" number box — blind. This
 * draws the actual waveform, lets you drag the window onto the part of the
 * song you mean, and auditions it in a loop before you commit. Peaks come
 * from decoding the audio in-browser (the server has no decoder either way).
 */
export function HookEditor({
  audioUrl,
  ceilingMs,
  accent,
  onAdd,
}: {
  audioUrl: string;
  ceilingMs: number;
  accent: string;
  /** commits a new hook exactly like the old number inputs did */
  onAdd: (startMs: number, durationMs: number) => Promise<void> | void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [startMs, setStartMs] = useState(0);
  const [durMs, setDurMs] = useState(Math.min(15_000, ceilingMs));
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const loopRef = useRef(false);
  // refs mirroring state so the rAF loop reads current values without
  // re-subscribing every render
  const winRef = useRef({ startMs, durMs });
  winRef.current = { startMs, durMs };

  // decode once, draw peaks
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPeaks(null);
    void (async () => {
      try {
        const res = await fetch(audioUrl);
        if (!res.ok) throw new Error("couldn't fetch audio");
        const buf = await res.arrayBuffer();
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const decoded = await ctx.decodeAudioData(buf);
        void ctx.close();
        if (cancelled) return;
        const data = decoded.getChannelData(0);
        const bucket = Math.floor(data.length / PEAKS) || 1;
        const out: number[] = [];
        for (let i = 0; i < PEAKS; i++) {
          let peak = 0;
          for (let j = i * bucket; j < Math.min((i + 1) * bucket, data.length); j += 16) {
            const v = Math.abs(data[j]);
            if (v > peak) peak = v;
          }
          out.push(peak);
        }
        const max = Math.max(...out, 0.01);
        setPeaks(out.map((p) => p / max));
      } catch {
        if (!cancelled) setError("Waveform unavailable for this audio — use the boxes below.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audioUrl]);

  // draw whenever peaks or the window changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 72;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.28)";
    const bar = w / peaks.length;
    const fromFrac = startMs / Math.max(ceilingMs, 1);
    const toFrac = (startMs + durMs) / Math.max(ceilingMs, 1);
    peaks.forEach((p, i) => {
      const frac = i / peaks.length;
      const inWindow = frac >= fromFrac && frac <= toFrac;
      g.fillStyle = inWindow ? accent : "rgba(255,255,255,0.22)";
      const bh = Math.max(2, p * (h - 6));
      g.fillRect(i * bar, (h - bh) / 2, Math.max(bar - 0.5, 0.5), bh);
    });
  }, [peaks, startMs, durMs, ceilingMs, accent]);

  // audition loop: play the selected window, repeat while the toggle is held
  const tick = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !loopRef.current) return;
    const { startMs: s, durMs: d } = winRef.current;
    if (audio.currentTime * 1000 >= s + d || audio.currentTime * 1000 < s - 50) {
      audio.currentTime = s / 1000;
    }
    requestAnimationFrame(tick);
  }, []);

  const audition = () => {
    const audio = audioRef.current ?? (audioRef.current = new Audio());
    if (playing) {
      loopRef.current = false;
      audio.pause();
      setPlaying(false);
      return;
    }
    audio.src = audioUrl;
    audio.currentTime = startMs / 1000;
    void audio.play().then(() => {
      loopRef.current = true;
      setPlaying(true);
      requestAnimationFrame(tick);
      audio.onended = () => {
        loopRef.current = false;
        setPlaying(false);
      };
    }).catch(() => setError("Playback was blocked — try again."));
  };

  // ---- dragging: grab either handle, or the middle to slide the whole thing
  const drag = useRef<{ mode: "l" | "r" | "move"; x: number; s: number; d: number } | null>(null);
  const pctToMs = useCallback(
    (clientX: number) => {
      const rect = regionRef.current?.parentElement?.getBoundingClientRect();
      if (!rect) return 0;
      const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      return Math.round(frac * ceilingMs);
    },
    [ceilingMs],
  );

  const onDragStart = (mode: "l" | "r" | "move") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, s: startMs, d: durMs };
  };
  const onDragMove = (e: React.PointerEvent) => {
    const dragState = drag.current;
    if (!dragState) return;
    const deltaMs = pctToMs(e.clientX) - pctToMs(dragState.x);
    const minDur = 5_000;
    const maxDur = Math.min(45_000, ceilingMs);
    if (dragState.mode === "move") {
      let s = dragState.s + deltaMs;
      s = Math.min(Math.max(s, 0), ceilingMs - dragState.d);
      setStartMs(Math.max(0, s));
    } else if (dragState.mode === "l") {
      let s = dragState.s + deltaMs;
      s = Math.min(Math.max(0, s), dragState.s + dragState.d - minDur);
      const d = dragState.d + (dragState.s - s);
      setStartMs(s);
      setDurMs(Math.min(maxDur, d));
    } else {
      let end = dragState.s + dragState.d + deltaMs;
      end = Math.min(Math.max(end, dragState.s + minDur), Math.min(ceilingMs, dragState.s + maxDur));
      setDurMs(end - dragState.s);
    }
  };
  const onDragEnd = () => {
    drag.current = null;
  };

  const style = useMemo(
    () => ({
      left: `${Math.min(100, (startMs / Math.max(ceilingMs, 1)) * 100)}%`,
      width: `${Math.min(100, (durMs / Math.max(ceilingMs, 1)) * 100)}%`,
    }),
    [startMs, durMs, ceilingMs],
  );

  return (
    <div className="hook-editor">
      <div className="hook-editor-canvas" ref={regionRef}>
        {peaks ? (
          <canvas ref={canvasRef} style={{ width: "100%", height: 72, display: "block" }} />
        ) : (
          <div className="hook-editor-loading">{error ?? "decoding waveform…"}</div>
        )}
        <div
          className="hook-editor-window"
          style={style}
          onPointerDown={onDragStart("move")}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <span className="hook-editor-grip" onPointerDown={onDragStart("l")}
            onPointerMove={onDragMove} onPointerUp={onDragEnd} aria-label="drag window start" />
          <span className="hook-editor-grip" onPointerDown={onDragStart("r")}
            onPointerMove={onDragMove} onPointerUp={onDragEnd} aria-label="drag window end" />
        </div>
      </div>
      <div className="hook-editor-row">
        <button type="button" className={`aq-btn ${playing ? "yes" : ""}`} onClick={audition}>
          {playing ? "■ stop" : "▶ audition loop"}
        </button>
        <span className="hook-editor-readout">
          {Math.floor(startMs / 1000)}s → {Math.floor((startMs + durMs) / 1000)}s ·{" "}
          {Math.round(durMs / 1000)}s
        </span>
        <button
          type="button"
          className="aq-btn yes"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd(startMs, durMs);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "saving…" : "+ add this hook"}
        </button>
      </div>
    </div>
  );
}
