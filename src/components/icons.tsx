interface IconProps {
  size?: number;
  strokeWidth?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconBack = ({ size = 20, strokeWidth = 2.2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>
);

export const IconPlay = ({ size = 24 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5.5v13a.6.6 0 0 0 .92.5l10.2-6.5a.6.6 0 0 0 0-1L8.92 5a.6.6 0 0 0-.92.5Z" />
  </svg>
);

export const IconPause = ({ size = 24 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="5" width="4.2" height="14" rx="1.4" />
    <rect x="13.8" y="5" width="4.2" height="14" rx="1.4" />
  </svg>
);

export const IconHeart = ({ size = 20, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 20.5S3.5 15.5 3.5 9.6a4.6 4.6 0 0 1 8.5-2.5 4.6 4.6 0 0 1 8.5 2.5c0 5.9-8.5 10.9-8.5 10.9Z" />
  </svg>
);

export const IconX = ({ size = 20, strokeWidth = 2.4 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconSkipUp = ({ size = 20, strokeWidth = 2.2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 19V6" />
    <path d="m6 12 6-6 6 6" />
  </svg>
);

export const IconSparkle = ({ size = 20, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 3.5 13.8 9 19.5 11l-5.7 2-1.8 5.5L10.2 13 4.5 11l5.7-2L12 3.5Z" />
  </svg>
);

export const IconHome = ({ size = 19, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="m4 10 8-6.5L20 10v9.4a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19.4V10Z" />
    <path d="M9.5 21v-6.5h5V21" />
  </svg>
);

export const IconDisc = ({ size = 19, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2.2" />
  </svg>
);

export const IconFolder = ({ size = 20, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2.4H19a1.5 1.5 0 0 1 1.5 1.5v8.1A1.5 1.5 0 0 1 19 19.5H5a1.5 1.5 0 0 1-1.5-1.5v-10.5Z" />
  </svg>
);

export const IconPlaylistAdd = ({ size = 20, strokeWidth = 2.1 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M4 6h12M4 11h8" />
    <path d="M17 11v8M13 15h8" />
    <circle cx="6.5" cy="18" r="2.5" />
    <path d="M9 18V9" />
  </svg>
);

export const IconCheck = ({ size = 18, strokeWidth = 2.6 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="m4.5 12.5 5 5L19.5 7" />
  </svg>
);

export const IconSettings = ({ size = 18, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V19.7a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.12-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H2.3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.12 1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 6.38 2.8l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V1.3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08c.26.63.88 1.03 1.56 1.03h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
  </svg>
);

export const IconExternal = ({ size = 16, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M19 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5H11" />
  </svg>
);

export const IconVolume = ({ size = 18, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M11 5 6.5 8.5H3v7h3.5L11 19V5Z" />
    <path d="M15 9a4.2 4.2 0 0 1 0 6" />
    <path d="M17.5 6.5a8 8 0 0 1 0 11" />
  </svg>
);

export const IconVolumeMute = ({ size = 18, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M11 5 6.5 8.5H3v7h3.5L11 19V5Z" />
    <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" />
  </svg>
);

export const IconUser = ({ size = 19, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5 20c.8-3.4 3.6-5.2 7-5.2s6.2 1.8 7 5.2" />
  </svg>
);

export const IconArrow = ({
  size = 36,
  strokeWidth = 2.4,
  rotate = 0,
}: IconProps & { rotate?: number }) => (
  <svg {...base(size)} strokeWidth={strokeWidth} style={{ rotate: `${rotate}deg` }}>
    <path d="M12 20V4" />
    <path d="m5 11 7-7 7 7" />
  </svg>
);
