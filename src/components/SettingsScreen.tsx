import { motion } from "motion/react";
import { authClient } from "../lib/auth-client";
import { useStore } from "../state/store";
import { IconBack, IconCheck, IconFolder, IconHeart, IconUser } from "./icons";

export function SettingsScreen({
  isAdmin,
  onBack,
  onOpenProfile,
  onOpenSaveTarget,
  onReplayTutorial,
  onAutoAdvance,
}: {
  isAdmin: boolean;
  onBack: () => void;
  onOpenProfile: () => void;
  onOpenSaveTarget: () => void;
  onReplayTutorial: () => void;
  onAutoAdvance: (value: boolean) => void;
}) {
  const { state } = useStore();
  const session = authClient.useSession();

  const targetLabel =
    state.saveTarget === "liked"
      ? "Liked Songs"
      : state.saveTarget === "discoveries"
        ? "Discoveries"
        : (state.playlists.find((p) => `pl:${p.id}` === state.saveTarget)?.name ??
          "Liked Songs");

  return (
    <div className="library">
      <header className="topbar">
        <button className="topbar-btn" onClick={onBack} aria-label="Back">
          <IconBack />
        </button>
        <span className="wordmark">
          hooked<span className="dot">.</span>
        </span>
        <span style={{ width: 42 }} />
      </header>

      <motion.div
        className="library-body"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="library-title" style={{ marginBottom: 14 }}>
          Settings
        </h2>

        <p className="settings-group">swiping</p>
        <button className="settings-row" onClick={onOpenSaveTarget}>
          <span className="settings-row-icon" style={{ color: "var(--save)" }}>
            {state.saveTarget === "liked" ? <IconHeart size={17} /> : <IconFolder size={17} />}
          </span>
          <span className="settings-row-label">
            Swipe down saves to
            <small>{targetLabel}</small>
          </span>
          <span className="settings-row-value">change</span>
        </button>
        <button
          className="settings-row"
          onClick={() => onAutoAdvance(!state.autoAdvance)}
        >
          <span className="settings-row-icon" style={{ color: "var(--more)" }}>
            ▶
          </span>
          <span className="settings-row-label">
            Auto-advance
            <small>jump to the next song when a preview ends</small>
          </span>
          <span className={`toggle ${state.autoAdvance ? "on" : ""}`}>
            <span className="toggle-knob" />
          </span>
        </button>

        <p className="settings-group">account</p>
        <button className="settings-row" onClick={onOpenProfile}>
          <span className="settings-row-icon"><IconUser size={17} /></span>
          <span className="settings-row-label">
            {session.data ? session.data.user.email : "Sign in"}
            <small>
              {session.data
                ? "your library syncs to the cloud"
                : "create an account to keep your taste forever"}
            </small>
          </span>
          <span className="settings-row-value">open</span>
        </button>
        {isAdmin && (
          <a className="settings-row" href="#/admin" style={{ textDecoration: "none" }}>
            <span className="settings-row-icon" style={{ color: "var(--accent)" }}>
              <IconCheck size={17} />
            </span>
            <span className="settings-row-label">
              Admin dashboard
              <small>live stats, users, permissions, catalog</small>
            </span>
            <span className="settings-row-value">open</span>
          </a>
        )}

        <p className="settings-group">app</p>
        <button className="settings-row" onClick={onReplayTutorial}>
          <span className="settings-row-icon">↻</span>
          <span className="settings-row-label">
            Replay the swipe tutorial
            <small>relearn the four gestures</small>
          </span>
        </button>
        <button
          className="settings-row"
          onClick={() => {
            if (window.confirm("Clear your local library and history on this device?")) {
              localStorage.removeItem("hooked.library.v2");
              window.location.reload();
            }
          }}
        >
          <span className="settings-row-icon" style={{ color: "var(--never)" }}>✕</span>
          <span className="settings-row-label" style={{ color: "var(--never)" }}>
            Reset local data
            <small>cloud library is untouched</small>
          </span>
        </button>
      </motion.div>
    </div>
  );
}
