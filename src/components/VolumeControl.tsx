import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconVolume, IconVolumeMute } from "./icons";

/**
 * Hardware-style volume rocker on the phone frame's edge: a slim vertical
 * rail floating just outside the bezel, like a real phone's volume buttons.
 * Drag to set, scroll to nudge, tap the speaker to mute. Desktop only — the
 * frame is full-bleed on real phones, which have hardware volume keys.
 */
export function VolumeRail({
  volume,
  onVolume,
  visible,
}: {
  volume: number;
  onVolume: (v: number) => void;
  visible: boolean;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false); // dragging → show the % readout
  const lastNonZero = useRef(volume > 0 ? volume : 1);
  if (volume > 0) lastNonZero.current = volume;

  const setFromY = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    onVolume(1 - (clientY - rect.top) / rect.height);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="volume-rail"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          onWheel={(e) => onVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05))}
        >
          <AnimatePresence>
            {active && (
              <motion.span
                className="volume-readout"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
              >
                {Math.round(volume * 100)}
              </motion.span>
            )}
          </AnimatePresence>
          <div
            ref={trackRef}
            className="volume-track"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setActive(true);
              setFromY(e.clientY);
            }}
            onPointerMove={(e) => {
              if (e.buttons > 0) setFromY(e.clientY);
            }}
            onPointerUp={() => setActive(false)}
            onPointerCancel={() => setActive(false)}
          >
            <div className="volume-fill" style={{ height: `${volume * 100}%` }} />
            <div className="volume-knob" style={{ bottom: `calc(${volume * 100}% - 6px)` }} />
          </div>
          <button
            className="volume-speaker"
            onClick={() => onVolume(volume === 0 ? lastNonZero.current : 0)}
            aria-label={volume === 0 ? "Unmute" : "Mute"}
            title={volume === 0 ? "Unmute" : "Mute"}
            style={volume === 0 ? { color: "var(--never)" } : undefined}
          >
            {volume === 0 ? <IconVolumeMute size={15} /> : <IconVolume size={15} />}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
