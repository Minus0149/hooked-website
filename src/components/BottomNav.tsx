import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconDisc, IconHome } from "./icons";

export type View = "home" | "discover";

const NOTCH_R = 33; // notch circle radius
const FILLET = 9; // shoulder radius — the "water droplet" outward swell
const DIP = 5; // notch circle center sits this far below the bar's top edge
const OVER = 12; // how far the droplet shoulders rise above the bar's edge

/**
 * Bar silhouette as a single SVG path: the top edge SWELLS OUTWARD (upward)
 * through convex shoulder arcs before wrapping around the notch — a true
 * water-droplet profile, perfectly symmetric by construction.
 */
function barPath(w: number, h: number, notch: boolean): string {
  const R = h / 2;
  if (!notch) {
    return `M ${R} 0.5 H ${w - R} A ${R - 0.5} ${R - 0.5} 0 0 1 ${w - R} ${h - 0.5} H ${R} A ${R - 0.5} ${R - 0.5} 0 0 1 ${R} 0.5 Z`;
  }
  const cx = w / 2;
  // shoulder circles sit ABOVE the edge (centers at y = -FILLET), tangent to
  // the edge and externally tangent to the notch circle — so the silhouette
  // bulges up and out before diving around the button
  const xf = Math.sqrt((NOTCH_R + FILLET) ** 2 - (DIP + FILLET) ** 2);
  // tangency point between shoulder and notch circle (on their center line)
  const k = NOTCH_R / (NOTCH_R + FILLET);
  const tx = xf * k;
  const ty = DIP + (-FILLET - DIP) * k;
  return [
    `M ${R} 0.5`,
    `H ${cx - xf}`,
    `A ${FILLET} ${FILLET} 0 0 0 ${cx - tx} ${ty}`, // shoulder swells outward
    `A ${NOTCH_R} ${NOTCH_R} 0 1 0 ${cx + tx} ${ty}`, // around the button
    `A ${FILLET} ${FILLET} 0 0 0 ${cx + xf} 0.5`, // and back down to the edge
    `H ${w - R}`,
    `A ${R - 0.5} ${R - 0.5} 0 0 1 ${w - R} ${h - 0.5}`,
    `H ${R}`,
    `A ${R - 0.5} ${R - 0.5} 0 0 1 ${R} 0.5`,
    `Z`,
  ].join(" ");
}

export function BottomNav({
  view,
  showCreate,
  onChange,
  onCreate,
}: {
  view: View;
  showCreate: boolean; // the + (and its notch) only live on the home screen
  onChange: (v: View) => void;
  onCreate: () => void;
}) {
  const barRef = useRef<HTMLElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setDims({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="bottomnav-dock">
      <nav ref={barRef} className={`bottomnav ${dims ? "shaped" : ""}`}>
        {dims && (
          <svg
            className="bottomnav-shape"
            width={dims.w}
            height={dims.h + OVER}
            viewBox={`0 ${-OVER} ${dims.w} ${dims.h + OVER}`}
            style={{ top: -OVER }}
            aria-hidden
          >
            <path
              d={barPath(dims.w, dims.h, showCreate)}
              style={{
                fill: "color-mix(in srgb, var(--surface) 96%, transparent)",
                stroke: "var(--line)",
                strokeWidth: 1,
              }}
            />
          </svg>
        )}
        <button
          className={`nav-btn ${view === "home" ? "active" : ""}`}
          onClick={() => onChange("home")}
        >
          <IconHome size={22} />
          <span className="nav-btn-label">Home</span>
        </button>
        <span className="nav-fab-slot" aria-hidden />
        <button
          className={`nav-btn ${view === "discover" ? "active" : ""}`}
          onClick={() => onChange("discover")}
        >
          <IconDisc size={22} />
          <span className="nav-btn-label">Discover</span>
        </button>
        {/* lives INSIDE the bar so the + and the notch share one center */}
        <AnimatePresence initial={false}>
          {showCreate && (
            <motion.div
              key="fab"
              className="nav-fab-host"
              initial={{ scale: 0, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0, y: 18 }}
              transition={{ type: "spring", stiffness: 420, damping: 26 }}
            >
              <button
                className="nav-fab"
                onClick={onCreate}
                aria-label="Create a playlist"
                title="Create a playlist"
              >
                +
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </div>
  );
}
