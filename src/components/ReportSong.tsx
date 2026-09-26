import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Track } from "../types";
import {
  REPORT_COPY,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  cleanReportNote,
  type ReportReason,
} from "../lib/contentReport";

/**
 * "Report this song", inside the full-song sheet (Google Play's UGC policy).
 * Works signed out: the device's anonymous key holds guests to a rate limit.
 * Same words and order as the phone app (lib/contentReport.ts).
 */
export function ReportSong({ track, onBack, onDone }: { track: Track; onBack: () => void; onDone: () => void }) {
  const submit = useMutation(api.contentReports.submit);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (busy) return;
    if (!reason) {
      setError(REPORT_COPY.pick);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let anonKey: string | undefined;
      try {
        anonKey = localStorage.getItem("hooked.anon") ?? undefined;
      } catch {
        anonKey = undefined;
      }
      await submit({
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        reason,
        note: cleanReportNote(note) || undefined,
        anonKey,
      });
      setSent(true);
    } catch (err) {
      const m = err instanceof Error ? err.message : "";
      setError(/rate|too many|slow down/i.test(m) ? "That's a lot of reports — try again in a while." : "Couldn't send that report. Try again?");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="report" role="status">
        <h3 className="sheet-title">{REPORT_COPY.doneTitle}</h3>
        <p className="sheet-sub">{REPORT_COPY.doneSub}</p>
        <button className="ob-primary auth-submit" onClick={onDone}>
          {REPORT_COPY.close}
        </button>
      </div>
    );
  }

  return (
    <div className="report">
      <h3 className="sheet-title">{REPORT_COPY.title}</h3>
      <p className="sheet-sub">
        "{track.title}" — {track.artist}. {REPORT_COPY.sub}
      </p>
      <div className="report-reasons" role="radiogroup" aria-label="Reason">
        {REPORT_REASONS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={reason === r.id}
            className={`report-reason${reason === r.id ? " on" : ""}`}
            onClick={() => {
              setReason(r.id);
              setError(null);
            }}
          >
            <span className="report-dot" aria-hidden />
            <span className="report-reason-text">
              <strong>{r.label}</strong>
              <small>{r.hint}</small>
            </span>
          </button>
        ))}
      </div>
      <label className="auth-field">
        <span className="auth-label">{REPORT_COPY.noteLabel}</span>
        <textarea
          className="auth-input report-note"
          placeholder={REPORT_COPY.notePlaceholder}
          value={note}
          maxLength={REPORT_NOTE_MAX}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {error && (
        <div className="auth-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <button className="ob-primary auth-submit" onClick={() => void send()} disabled={busy}>
        {busy ? REPORT_COPY.busy : REPORT_COPY.submit}
      </button>
      <button type="button" className="auth-link auth-link-center" onClick={onBack}>
        {REPORT_COPY.back}
      </button>
    </div>
  );
}
