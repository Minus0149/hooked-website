/**
 * "Report this song": the reasons, the words and the rules, shared by both
 * apps so the form reads identically. Google Play's user-generated-content
 * policy (creator uploads) requires an in-app way to report content.
 *
 * Mirrored in mobile/src/lib/contentReport.ts (scripts/check-mirrors.mjs); the
 * backend keeps its own copy of the ids (convex/contentReports.ts) and a test
 * checks the two agree.
 */

export const REPORT_REASONS = [
  { id: "copyright", label: "Copyright", hint: "it's someone else's work and shouldn't be here" },
  { id: "offensive", label: "Offensive or hateful", hint: "hate, harassment or violence" },
  { id: "sexual", label: "Sexual content", hint: "explicit art or lyrics that break the rules" },
  { id: "spam", label: "Spam or misleading", hint: "wrong song, fake artist, a scam" },
  { id: "other", label: "Something else", hint: "tell us in the note" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export const REPORT_NOTE_MAX = 300;

export const REPORT_COPY = {
  link: "Report this song",
  title: "Report this song",
  sub: "What's wrong with it? A person looks at every report.",
  noteLabel: "anything else",
  notePlaceholder: "optional — what we should know",
  submit: "Send report",
  busy: "Sending…",
  pick: "Pick a reason first.",
  doneTitle: "Thanks — we'll look at it.",
  doneSub: "If it breaks the rules it comes out of the deck for everyone.",
  close: "Close",
  back: "Back",
} as const;

export function isReportReason(x: unknown): x is ReportReason {
  return REPORT_REASONS.some((r) => r.id === x);
}

/** Trimmed, whitespace collapsed, capped — the note is free text from anyone. */
export function cleanReportNote(note: string | null | undefined): string {
  return (note ?? "").replace(/\s+/g, " ").trim().slice(0, REPORT_NOTE_MAX);
}
