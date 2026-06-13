import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import type { Track } from "../types";

export interface SaveRelease {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SaveFxData {
  key: number;
  track: Track;
  from: SaveRelease;
  mode: "fast" | "cinematic";
}

const DISC = 96; // disc diameter
const SLEEVE_W = 172;
const SLEEVE_H = 152;
const SLEEVE_BOTTOM = -10; // pokes below the deck edge
const LIP = 13; // slot depth: disc is visible against the dark interior for this many px

const TIMING = {
  fast: { morph: 0.18, slide: 0.14, spin: 130, hover: 0, linger: 180 },
  cinematic: { morph: 0.3, slide: 0.24, spin: 280, hover: 140, linger: 460 },
};

/**
 * The save moment: the released card keeps your swipe's momentum, morphs into
 * a spinning vinyl disc (album art becomes the label), and slides into an
 * album sleeve printed with the track's own artwork. The sleeve is a sandwich
 * — back panel behind the disc, front face clipped below the slot line — so
 * the disc visibly enters the mouth instead of hiding behind a square.
 */
export function DiscFX({
  data,
  deckW,
  deckH,
  sticker,
  onDone,
}: {
  data: SaveFxData;
  deckW: number;
  deckH: number;
  sticker: string;
  onDone: () => void;
}) {
  const { from, track, mode } = data;

  // disc body — starts as the card (full deck size, card radius, drag rotation)
  const x = useMotionValue(from.x);
  const y = useMotionValue(from.y);
  const w = useMotionValue(deckW);
  const h = useMotionValue(deckH);
  const br = useMotionValue(28);
  const spin = useMotionValue((from.x / 220) * 13); // inherit the drag tilt
  const morph = useMotionValue(0);
  const dim = useMotionValue(0);
  const discOpacity = useMotionValue(1);

  // sleeve
  const sleeveY = useMotionValue(SLEEVE_H + 40);
  const sleeveRot = useMotionValue(-6);
  const sleeveSquash = useMotionValue(1);
  const stickerPop = useMotionValue(0);

  const artOpacity = useTransform(morph, [0, 0.55], [1, 0]);
  const vinylOpacity = useTransform(morph, [0.25, 0.75], [0, 1]);
  const mL = useTransform(w, (v) => -v / 2);
  const mT = useTransform(h, (v) => -v / 2);

  useEffect(() => {
    const t = TIMING[mode];
    let alive = true;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // geometry (coordinates are relative to the deck center, like the card's)
    const sleeveTopY = deckH / 2 + SLEEVE_BOTTOM - SLEEVE_H;
    const hoverY = sleeveTopY - DISC / 2 - 6; // disc bottom kisses the mouth
    const inY = sleeveTopY + LIP + DISC / 2 + 26; // fully swallowed

    const run = async () => {
      // sleeve slides up while the card SHRINKS mid-flight — no rotation yet;
      // spinning a card-sized rectangle reads as chaos, so the tilt just settles
      void animate(sleeveY, 0, { type: "spring", stiffness: 520, damping: 30 });
      void animate(sleeveRot, 0, { duration: 0.22, ease: "easeOut" });
      void animate(w, DISC, { duration: t.morph, ease: "easeIn" });
      void animate(h, DISC, { duration: t.morph, ease: "easeIn" });
      void animate(br, DISC / 2, { duration: t.morph, ease: "easeIn" });
      void animate(morph, 1, { duration: t.morph });
      void animate(spin, 0, { duration: t.morph, ease: "easeOut" }); // settle the drag tilt
      // momentum-seeded springs: the disc continues the way you threw it
      await Promise.all([
        animate(x, 0, { type: "spring", stiffness: 480, damping: 34, velocity: from.vx }),
        animate(y, hoverY, { type: "spring", stiffness: 480, damping: 34, velocity: Math.max(from.vy, 300) }),
      ]);
      if (!alive) return;
      if (t.hover) await sleep(t.hover); // cinematic beat: the disc hangs over the slot
      // NOW it spins — a modest turn while disc-sized, sliding into the mouth
      void animate(spin, t.spin, { duration: t.slide + 0.18, ease: "easeOut" });
      void animate(dim, 0.65, { duration: t.slide });
      await animate(y, inY, { duration: t.slide, ease: "easeIn" });
      if (!alive) return;
      // the disc is now fully covered by the sleeve face — fade it out here so
      // nothing gets revealed (no "ghost") when the sleeve slides away later
      void animate(discOpacity, 0, { duration: 0.12 });
      // thunk
      void animate(sleeveSquash, [1, 0.93, 1], { duration: 0.24, times: [0, 0.45, 1] });
      void animate(sleeveY, [0, 7, 0], { duration: 0.26, times: [0, 0.4, 1] });
      void animate(stickerPop, 1, { type: "spring", stiffness: 520, damping: 16 });
      await sleep(t.linger);
      if (!alive) return;
      // leave
      await Promise.all([
        animate(sleeveY, SLEEVE_H + 60, { duration: 0.22, ease: "easeIn" }),
        animate(sleeveRot, 4, { duration: 0.22 }),
      ]);
      onDone();
    };
    void run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sleeveTransform = { y: sleeveY, rotate: sleeveRot, scaleY: sleeveSquash };

  return (
    <div className="discfx">
      {/* back panel + dark interior — the disc passes IN FRONT of this */}
      <motion.div className="sleeve2" style={sleeveTransform}>
        <div className="sleeve2-back" />
      </motion.div>

      {/* the card-turned-disc */}
      <motion.div
        className="disc"
        style={{ x, y, width: w, height: h, borderRadius: br, rotate: spin, marginLeft: mL, marginTop: mT, opacity: discOpacity }}
      >
        <motion.img
          className="disc-card-art"
          src={track.artwork}
          alt=""
          style={{ opacity: artOpacity }}
          draggable={false}
        />
        <motion.div className="disc-vinyl" style={{ opacity: vinylOpacity }}>
          <span
            className="disc-label"
            style={{ backgroundImage: `url(${track.artwork})`, borderColor: track.accent }}
          />
          <span className="disc-hole" />
        </motion.div>
        <motion.div className="disc-dim" style={{ opacity: dim, borderRadius: br }} />
      </motion.div>

      {/* front face, clipped below the slot line — the disc slides BEHIND this */}
      <motion.div className="sleeve2" style={sleeveTransform}>
        <div className="sleeve2-front" style={{ borderColor: `color-mix(in srgb, ${track.accent} 55%, #2a2430)` }}>
          <img src={track.artwork} alt="" draggable={false} />
          <span className="sleeve2-tint" style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${track.accent} 38%, transparent), rgba(8, 8, 12, 0.9))` }} />
          <span className="sleeve2-wordmark">hooked.</span>
        </div>
        <motion.span
          className="sleeve-sticker"
          style={{ scale: stickerPop, opacity: stickerPop, background: track.accent }}
        >
          {sticker}
        </motion.span>
      </motion.div>
    </div>
  );
}
