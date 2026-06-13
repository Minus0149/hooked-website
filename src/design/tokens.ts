// Shared design tokens — keep in sync with mobile/src/design/tokens.ts
export const colors = {
  bg: "#08080C",
  surface: "#13131B",
  surface2: "#1C1C26",
  line: "#26262F",
  text: "#F4F2EE",
  muted: "#8E8C99",
  accentDefault: "#FF3D71",
  save: "#00E5A0",
  never: "#FF5252",
  more: "#FFB627",
};

export const fonts = {
  display: "'Unbounded', sans-serif",
  body: "'Instrument Sans', sans-serif",
};

export const gesture = {
  commitDistance: 90, // px before a drag commits to an action
  commitVelocity: 650, // px/s flick that commits regardless of distance
  axisDominance: 1.35, // dominant axis must exceed the other by this ratio
};

export const radii = { card: 28, tile: 20, pill: 999 };
