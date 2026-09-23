import type { ReactElement } from "react";
import type { MoodId } from "../data/mood";

/**
 * Six faces, drawn.
 *
 * Emoji would have been one line of code and the wrong answer. A system emoji
 * is a different picture on Windows, Android and iOS, it arrives in somebody
 * else's colours in the middle of a deliberately dark room, and it can't take
 * the accent of the mood it stands for. These are strokes in `currentColor`,
 * so the same six faces are the same six faces everywhere and each one wears
 * its own colour when it's the one that's picked.
 *
 * All six share a head and differ only in eyes and mouth, which is what makes
 * them read as a set rather than as six clip-art pieces.
 */

interface FaceProps {
  size?: number;
  strokeWidth?: number;
}

const shell = (size: number, strokeWidth: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

const Head = () => <circle cx="12" cy="12" r="9.2" />;

/** Eyes up, mouth open, brows in: the one that means "go". */
const FaceHyped = ({ size = 28, strokeWidth = 1.7 }: FaceProps) => (
  <svg {...shell(size, strokeWidth)}>
    <Head />
    <path d="M7 8.6 9.9 10" />
    <path d="M17 8.6 14.1 10" />
    <path d="M8.6 14.2h6.8a3.4 3.4 0 0 1-6.8 0Z" fill="currentColor" stroke="none" />
  </svg>
);

/** Eyes shut with delight, grin wide, one spark off the temple. */
const FaceParty = ({ size = 28, strokeWidth = 1.7 }: FaceProps) => (
  <svg {...shell(size, strokeWidth)}>
    <Head />
    <path d="M7.4 10.4a1.9 1.9 0 0 1 3 0" />
    <path d="M13.6 10.4a1.9 1.9 0 0 1 3 0" />
    <path d="M7.7 13.8a5 5 0 0 0 8.6 0" />
    <path d="M20.4 4.6v2.2M19.3 5.7h2.2" />
  </svg>
);

/** Plain, open, pleased. The default good mood. */
const FaceSunny = ({ size = 28, strokeWidth = 1.7 }: FaceProps) => (
  <svg {...shell(size, strokeWidth)}>
    <Head />
    <circle cx="9.1" cy="10.2" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="14.9" cy="10.2" r="1.05" fill="currentColor" stroke="none" />
    <path d="M8.2 14a4.6 4.6 0 0 0 7.6 0" />
  </svg>
);

/** Eyes low and level, mouth barely there. Content, not excited. */
const FaceChill = ({ size = 28, strokeWidth = 1.7 }: FaceProps) => (
  <svg {...shell(size, strokeWidth)}>
    <Head />
    <path d="M7.8 10.6h2.4" />
    <path d="M13.8 10.6h2.4" />
    <path d="M9.2 14.6a3.4 3.4 0 0 0 5.6 0" />
  </svg>
);

/** A held breath and a tear. The quiet one, on purpose. */
const FaceTender = ({ size = 28, strokeWidth = 1.7 }: FaceProps) => (
  <svg {...shell(size, strokeWidth)}>
    <Head />
    <circle cx="9.1" cy="10" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="14.9" cy="10" r="1.05" fill="currentColor" stroke="none" />
    <path d="M9.3 15.4a3.6 3.6 0 0 1 5.4 0" />
    <path d="M9.1 12.2c0 1.5-1 1.9-1 2.9a1 1 0 0 0 2 0c0-1-1-1.4-1-2.9Z" fill="currentColor" stroke="none" />
  </svg>
);

/** Shut eyes, small mouth, a z. Lights off. */
const FaceSleepy = ({ size = 28, strokeWidth = 1.7 }: FaceProps) => (
  <svg {...shell(size, strokeWidth)}>
    <Head />
    <path d="M7.6 10.8a1.9 1.9 0 0 0 3 0" />
    <path d="M13.4 10.8a1.9 1.9 0 0 0 3 0" />
    <circle cx="12" cy="15" r="1.3" />
    <path d="M18.6 3.4h2.6l-2.6 3h2.6" />
  </svg>
);

export const FACES: Record<MoodId, (props: FaceProps) => ReactElement> = {
  hyped: FaceHyped,
  party: FaceParty,
  sunny: FaceSunny,
  chill: FaceChill,
  tender: FaceTender,
  sleepy: FaceSleepy,
};

export function Face({ mood, size, strokeWidth }: FaceProps & { mood: MoodId }) {
  const Drawn = FACES[mood];
  return <Drawn size={size} strokeWidth={strokeWidth} />;
}
