import { useState } from "react";
import { motion } from "motion/react";
import { useDialog } from "../lib/dialog";
import { useT } from "../lib/lang";
import {
  exportFileName,
  playlistCsv,
  playlistText,
  SOUNDIIZ_URL,
  TUNEMYMUSIC_URL,
  type ExportTrack,
} from "../lib/playlistExport";
import { IconExternal, IconShare } from "./icons";

/**
 * Take a playlist to Spotify, Apple Music or YouTube Music — by way of a plain
 * list and a free transfer service, not a Spotify sign-in (see
 * lib/playlistExport.ts for why).
 */
export function ExportSheet({
  title,
  tracks,
  onClose,
}: {
  title: string;
  tracks: ExportTrack[];
  onClose: () => void;
}) {
  const t = useT();
  const dialog = useDialog({ onClose });
  const [copied, setCopied] = useState(false);
  const text = playlistText(tracks);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // no clipboard permission: select the preview so ctrl+c works
      const pre = document.getElementById("export-preview");
      if (pre) window.getSelection()?.selectAllChildren(pre);
    }
  };

  const download = () => {
    const blob = new Blob([playlistCsv(tracks)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <motion.div
        className="sheet-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="sheet export-sheet"
        aria-labelledby="export-title"
        initial={{ y: "110%" }}
        animate={{ y: 0 }}
        exit={{ y: "110%" }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        {...dialog}
      >
        <h3 className="sheet-title" id="export-title">
          {t("Take this playlist anywhere")}
        </h3>
        <p className="sheet-sub">
          {t(
            "Copy the list, then paste it into TuneMyMusic or Soundiiz — both are free for playlists this size and can add it to Spotify, Apple Music or YouTube Music.",
          )}
        </p>

        <pre className="export-preview" id="export-preview" aria-label={title}>
          {text}
        </pre>

        <div className="export-actions">
          <button type="button" className="library-cta" onClick={copy}>
            <IconShare size={15} /> {copied ? t("Copied") : t("Copy list")}
          </button>
          <button type="button" className="library-cta ghost" onClick={download}>
            {t("Download CSV")}
          </button>
        </div>

        <ol className="export-steps">
          <li>{t("1. Copy the list.")}</li>
          <li>{t("2. In TuneMyMusic choose “Free text” as the source and paste.")}</li>
          <li>{t("3. Pick where it goes — Spotify, Apple Music, YouTube Music — and confirm.")}</li>
        </ol>

        <div className="export-links">
          <a className="settings-row" href={TUNEMYMUSIC_URL} target="_blank" rel="noopener noreferrer">
            <span className="settings-row-label">{t("Open TuneMyMusic")}</span>
            <span className="settings-row-value"><IconExternal size={14} /></span>
          </a>
          <a className="settings-row" href={SOUNDIIZ_URL} target="_blank" rel="noopener noreferrer">
            <span className="settings-row-label">{t("Open Soundiiz")}</span>
            <span className="settings-row-value"><IconExternal size={14} /></span>
          </a>
        </div>
      </motion.div>
    </>
  );
}
