import { AnimatePresence, motion } from "motion/react";

/**
 * The house-ad card between swipes.
 *
 * Design rules, borrowed from how feeds that survive do it: the music keeps
 * playing underneath (this interrupts attention, never audio), it's labelled
 * plainly, one obvious action, and leaving is always one tap. It renders ABOVE
 * the deck rather than replacing a track, so closing it returns exactly where
 * the thumb was.
 */

export interface AdCardData {
  id: string;
  advertiser: string;
  title: string;
  body?: string;
  ctaLabel: string;
  ctaUrl: string;
  imageUrl: string | null;
  accent: string;
  seenToday?: number;
}

export function SponsoredCard({
  ad,
  onSkip,
  onClick,
  onWhy,
}: {
  ad: AdCardData;
  onSkip: () => void;
  onClick: () => void;
  /** hands focus to Settings → Support ("why am I seeing this?") */
  onWhy: () => void;
}) {
  return (
    <AnimatePresence>
      <motion.div
        className="ad-takeover"
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
        role="dialog"
        aria-label="Sponsored message"
      >
        <div className="ad-chip-row">
          <span className="ad-chip">Sponsored</span>
          <button className="ad-close" onClick={onSkip} aria-label="close this ad">
            ✕
          </button>
        </div>

        <div className="ad-body" style={{ ["--ad-accent" as string]: ad.accent }}>
          {ad.imageUrl && (
            <img src={ad.imageUrl} alt="" className="ad-art" loading="lazy" />
          )}
          <div className="ad-copy">
            <span className="ad-advertiser">{ad.advertiser}</span>
            <h3 className="ad-title">{ad.title}</h3>
            {ad.body && <p className="ad-sub">{ad.body}</p>}
            <a
              className="ad-cta"
              style={{ background: ad.accent }}
              href={ad.ctaUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={onClick}
            >
              {ad.ctaLabel}
            </a>
          </div>
        </div>

        <div className="ad-foot">
          <button className="ad-skip" onClick={onSkip}>
            no thanks
          </button>
          <button className="ad-why" onClick={onWhy}>
            why am I seeing this?
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
