/**
 * The six faces — a character each.
 *
 * They used to be one head with different eyes and mouths: tidy as a set, but
 * six versions of the same icon, and too plain to carry a mood. Each is now
 * its own someone, with a prop that says what it is and a small loop that
 * gives it away: hyped can't keep its brows down, party's hat won't sit
 * still, sunny's rays turn, chill's shades catch the light and a note drifts
 * off, tender lets a tear go, sleepy breathes out a row of z's.
 *
 * Drawn in currentColor so each takes its mood's colour (or ink, on a filled
 * wedge). The few cut-outs — a lens glint, a highlight in an eye, the hat's
 * stripes — use --face-cut, the colour behind the face.
 *
 * The motion is SMIL (<animate> inside the SVG), not CSS: it runs whatever the
 * page's reduced-motion CSS says, and the caller decides with `animated` —
 * the app from its in-app motion setting, the landing always.
 */
import type { ReactElement } from "react";
import type { MoodId } from "../data/mood";

type Props = { animated?: boolean; delay?: number };

const CUT = "var(--face-cut, #0b0b10)";
const round = { strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Head() {
  return <circle cx="24" cy="26" r="17" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeWidth="2.6" />;
}

/** a looping SMIL animation, only while animated */
function A(props: {
  on: boolean;
  attr: string;
  values: string;
  dur: string;
  begin: number;
  keyTimes?: string;
  transform?: "translate" | "scale" | "rotate";
}) {
  if (!props.on) return null;
  const common = {
    attributeName: props.attr,
    values: props.values,
    dur: props.dur,
    begin: `${props.begin.toFixed(2)}s`,
    repeatCount: "indefinite",
    ...(props.keyTimes ? { keyTimes: props.keyTimes } : {}),
  };
  return props.transform ? (
    <animateTransform {...common} type={props.transform} />
  ) : (
    <animate {...common} />
  );
}

/** Wide awake, brows up, shouting along — can't keep still. */
function Hyped({ animated = false, delay: d = 0 }: Props) {
  const on = animated;
  return (
    <>
      <Head />
      <g stroke="currentColor" strokeWidth="2.4" fill="none" {...round}>
        <path d="M4.5 14 7.5 17.5 5 19.5 8.5 23">
          <A on={on} attr="opacity" values="1;.15;1;1" keyTimes="0;.2;.4;1" dur=".8s" begin={d} />
        </path>
        <path d="M43.5 14 40.5 17.5 43 19.5 39.5 23">
          <A on={on} attr="opacity" values="1;1;.15;1" keyTimes="0;.4;.6;1" dur=".8s" begin={d} />
        </path>
      </g>
      <g stroke="currentColor" strokeWidth="2.8" fill="none" {...round}>
        <A on={on} attr="transform" transform="translate" values="0 0;0 -2.4;0 0" dur=".55s" begin={d} />
        <path d="M13.5 18.5q3.5-3.2 7 0" />
        <path d="M27.5 18.5q3.5-3.2 7 0" />
      </g>
      <circle cx="17" cy="24" r="2.8" fill="currentColor" />
      <circle cx="31" cy="24" r="2.8" fill="currentColor" />
      <circle cx="18" cy="23" r=".9" fill={CUT} />
      <circle cx="32" cy="23" r=".9" fill={CUT} />
      <g transform="translate(24 32)">
        <g>
          <A on={on} attr="transform" transform="scale" values="1 1;1.08 1.25;1 1" dur=".55s" begin={d} />
          <path d="M-7.5 -1.8h15a7.5 7.5 0 0 1-15 0Z" fill="currentColor" />
        </g>
      </g>
    </>
  );
}

/** Eyes squeezed shut with glee, a hat that won't sit still, confetti. */
function Party({ animated = false, delay: d = 0 }: Props) {
  const on = animated;
  return (
    <>
      <Head />
      <g transform="translate(30 13) scale(.82)">
        <g>
          <A on={on} attr="transform" transform="rotate" values="-10;12;-10" dur="1s" begin={d} />
          <path d="M-6.5 1.5 1.5 -12 6 3.5Z" fill="currentColor" />
          <path d="M-3.4 -3.8 3.3 -2.2M-1 -8 3.6 -7" stroke={CUT} strokeWidth="1.5" strokeLinecap="round" opacity=".6" />
          <circle cx="1.6" cy="-13.3" r="2.4" fill="currentColor" />
        </g>
      </g>
      <g stroke="currentColor" strokeWidth="2.6" fill="none" {...round}>
        <path d="M13.8 24.5a3.6 3.6 0 0 1 6.2 0" />
        <path d="M28 24.5a3.6 3.6 0 0 1 6.2 0" />
      </g>
      <path d="M14.5 30h19a9.5 9.5 0 0 1-19 0Z" fill="currentColor" />
      <g fill="currentColor">
        <rect x="5" y="6" width="3" height="3" rx=".6">
          <A on={on} attr="y" values="4;14;4" dur="1.6s" begin={d} />
          <A on={on} attr="opacity" values="0;1;0" dur="1.6s" begin={d} />
        </rect>
        <circle cx="42" cy="9" r="1.6">
          <A on={on} attr="cy" values="4;16;4" dur="1.9s" begin={d + 0.5} />
          <A on={on} attr="opacity" values="0;1;0" dur="1.9s" begin={d + 0.5} />
        </circle>
        <rect x="9" y="3" width="2.4" height="4" rx=".6">
          <A on={on} attr="y" values="1;11;1" dur="1.3s" begin={d + 0.9} />
          <A on={on} attr="opacity" values="0;1;0" dur="1.3s" begin={d + 0.9} />
        </rect>
      </g>
    </>
  );
}

/** A little sun: turning rays, rosy cheeks, a blink now and then. */
function Sunny({ animated = false, delay: d = 0 }: Props) {
  const on = animated;
  return (
    <>
      <g transform="translate(24 26)">
        <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <A on={on} attr="transform" transform="rotate" values="0;360" dur="14s" begin={d} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M0 -20.5V-23.5" transform={`rotate(${a})`} />
          ))}
        </g>
      </g>
      <circle cx="24" cy="26" r="16" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeWidth="2.6" />
      {[18.5, 29.5].map((x) => (
        <g key={x} transform={`translate(${x} 23.5)`}>
          <g>
            <A on={on} attr="transform" transform="scale" values="1 1;1 1;1 .12;1 1" keyTimes="0;.9;.95;1" dur="3.4s" begin={d} />
            <ellipse rx="2.3" ry="2.7" fill="currentColor" />
          </g>
        </g>
      ))}
      <circle cx="14.5" cy="29.5" r="2.1" fill="currentColor" fillOpacity=".35" />
      <circle cx="33.5" cy="29.5" r="2.1" fill="currentColor" fillOpacity=".35" />
      <path d="M17 30a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    </>
  );
}

/** Shades on, half a smile, a note drifting off. */
function Chill({ animated = false, delay: d = 0 }: Props) {
  const on = animated;
  return (
    <>
      <Head />
      <g fill="currentColor">
        <rect x="11" y="20" width="11" height="7" rx="3.2" />
        <rect x="26" y="20" width="11" height="7" rx="3.2" />
        <path d="M22 22.2h4" stroke="currentColor" strokeWidth="2" />
        <path d="M11 21.5 7.5 20M37 21.5 40.5 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </g>
      <path d="M14 25.5 17 21.5" stroke={CUT} strokeWidth="1.5" strokeLinecap="round" opacity={on ? 0 : 0.7}>
        <A on={on} attr="transform" transform="translate" values="0 0;0 0;16 0;16 0" keyTimes="0;.7;.85;1" dur="3.2s" begin={d} />
        <A on={on} attr="opacity" values="0;0;.8;0" keyTimes="0;.7;.8;.9" dur="3.2s" begin={d} />
      </path>
      <path d="M18.5 33.5c3.5 1.8 7.5 1.6 11-.8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <g fill="currentColor" stroke="currentColor" opacity={on ? 1 : 0.9}>
        <A on={on} attr="transform" transform="translate" values="0 4;4 -1;6 -5" dur="2.8s" begin={d} />
        <A on={on} attr="opacity" values="0;1;0" dur="2.8s" begin={d} />
        <circle cx="39" cy="12" r="2" stroke="none" />
        <path d="M40.8 12V5.5l3 1" fill="none" strokeWidth="1.6" {...round} />
      </g>
    </>
  );
}

/** Brows up in the middle, glassy eyes, a tear letting go. */
function Tender({ animated = false, delay: d = 0 }: Props) {
  const on = animated;
  return (
    <>
      <Head />
      <g stroke="currentColor" strokeWidth="2.4" fill="none" {...round}>
        <path d="M13.5 19.5 19.5 17.5" />
        <path d="M34.5 19.5 28.5 17.5" />
      </g>
      <circle cx="18" cy="24.5" r="2.6" fill="currentColor" />
      <circle cx="30" cy="24.5" r="2.6" fill="currentColor" />
      <circle cx="18.9" cy="23.5" r=".8" fill={CUT} />
      <circle cx="30.9" cy="23.5" r=".8" fill={CUT} />
      <path d="M19 34.5a6.5 6.5 0 0 1 10 0" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M14.6 27.2c0 2.3-1.6 3-1.6 4.5a1.6 1.6 0 0 0 3.2 0c0-1.5-1.6-2.2-1.6-4.5Z" fill="currentColor">
        <A on={on} attr="transform" transform="translate" values="0 -2;0 -2;0 7" keyTimes="0;.45;1" dur="2.6s" begin={d} />
        <A on={on} attr="opacity" values="0;1;1;0" keyTimes="0;.3;.75;1" dur="2.6s" begin={d} />
      </path>
    </>
  );
}

/** Eyes shut, a slow breath, z's rising. */
function Sleepy({ animated = false, delay: d = 0 }: Props) {
  const on = animated;
  const zs: [number, number, number][] = [
    [33, 15, 5.2],
    [39.5, 8.5, 4],
    [44.5, 2.5, 3],
  ];
  return (
    <>
      <Head />
      <g stroke="currentColor" strokeWidth="2.6" fill="none" {...round}>
        <path d="M13.5 24.5a4 4 0 0 0 7 0" />
        <path d="M27.5 24.5a4 4 0 0 0 7 0" />
      </g>
      <g transform="translate(24 33)">
        <g>
          <A on={on} attr="transform" transform="scale" values="1;1.35;1" dur="3s" begin={d} />
          <ellipse rx="2.4" ry="2" fill="currentColor" />
        </g>
      </g>
      <g fill="none" stroke="currentColor" {...round}>
        {zs.map(([x, y, w], k) => (
          <path key={k} d={`M${x} ${y}h${w}l-${w} ${w}h${w}`} strokeWidth={2.2 - k * 0.3}>
            <A on={on} attr="transform" transform="translate" values="-2 3;1 -2" dur="2.4s" begin={d + k * 0.8} />
            <A on={on} attr="opacity" values="0;1;0" dur="2.4s" begin={d + k * 0.8} />
          </path>
        ))}
      </g>
    </>
  );
}

const DRAWN: Record<MoodId, (props: Props) => ReactElement> = { hyped: Hyped, party: Party, sunny: Sunny, chill: Chill, tender: Tender, sleepy: Sleepy }
export type FaceMood = MoodId;

export const FACES = DRAWN;

export function Face({
  mood,
  size = 28,
  animated = false,
  delay = 0,
}: {
  mood: FaceMood;
  size?: number;
  /** play the face's loop (the app: in-app motion "full"; the landing: always) */
  animated?: boolean;
  /** seconds, so a row of faces doesn't move in unison */
  delay?: number;
  /** kept for older callers; the new faces have their own weights */
  strokeWidth?: number;
}) {
  const Drawn = DRAWN[mood];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ overflow: "visible" }}>
      <Drawn animated={animated} delay={delay} />
    </svg>
  );
}
