import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "../lib/auth-client";
import { ReplayRules } from "./settings/ReplayRules";
import { useStore } from "../state/store";
import {
  ACCENT_SWATCHES,
  HAPTICS_LEVELS,
  MOTION_LEVELS,
  type AccentMode,
  type HapticsLevel,
  type MotionLevel,
} from "../data/prefs";
import { ADVENTURE, availableTasteOptions, type Adventure, type TastePrefs } from "../data/taste";
import { IconBack, IconCheck, IconFolder, IconHeart, IconUser } from "./icons";

const BETA_URL = import.meta.env.VITE_BETA_URL ?? "https://hookedcue.com/beta";

function Group({ children }: { children: string }) {
  return <p className="settings-group">{children}</p>;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="prefs-segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={o.id === value}
          className={`prefs-chip ${o.id === value ? "on" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsScreen({
  isAdmin,
  onBack,
  onOpenProfile,
  onOpenSaveTarget,
  onReplayTutorial,
  onAutoAdvance,
  onReplay,
  onUnbury,
  onUnblockArtist,
  onSetPrefs,
  volume,
  onVolume,
  adsConfig,
}: {
  isAdmin: boolean;
  onBack: () => void;
  onOpenProfile: () => void;
  onOpenSaveTarget: () => void;
  onReplayTutorial: () => void;
  onAutoAdvance: (value: boolean) => void;
  onReplay: (container: string, allow: boolean) => void;
  onUnbury: (trackId: string) => void;
  onUnblockArtist: (artist: string) => void;
  onSetPrefs: (p: Partial<import("../data/prefs").UserPrefs>) => void;
  /** 0..1 — wired to the same player the deck uses */
  volume: number;
  onVolume: (v: number) => void;
  /** live pacing rules; null while loading or when opted out */
  adsConfig: {
    enabled: boolean;
    everyNSwipes: number;
    cooldownMinutes: number;
    maxPerDay: number;
  } | null;
}) {
  const { state, setTaste } = useStore();
  const session = authClient.useSession();
  const deleteAccount = useMutation(api.library.deleteMyAccount);
  const [deleting, setDeleting] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [adsConfirm, setAdsConfirm] = useState(false);
  const options = availableTasteOptions(state.catalog);

  const taste = state.taste;
  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  const editTaste = (patch: Partial<TastePrefs>) => setTaste({ ...taste, ...patch });

  // Google Play requires an in-app route to delete an account and its data.
  const removeAccount = async () => {
    if (!window.confirm("Delete your account and everything in it? This can't be undone.")) return;
    if (!window.confirm("Last check — your library, playlists and swipe history all go. Continue?")) return;
    setDeleting(true);
    try {
      await deleteAccount({ confirm: "DELETE" });
      await authClient.signOut();
      localStorage.removeItem("hooked.library.v2");
      window.location.reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not delete the account");
      setDeleting(false);
    }
  };

  const exportData = () => {
    // a real download of what this account holds — same shape the cloud has
    const payload = {
      exportedAt: new Date().toISOString(),
      taste,
      prefs: state.prefs,
      saveTarget: state.saveTarget,
      autoAdvance: state.autoAdvance,
      liked: state.liked.map(({ id, title, artist, album }) => ({ id, title, artist, album })),
      discoveries: state.discoveries.map(({ id, title, artist, album }) => ({ id, title, artist, album })),
      playlists: state.playlists.map((p) => ({
        name: p.name,
        accent: p.accent,
        tracks: p.tracks.map(({ id, title, artist }) => ({ id, title, artist })),
      })),
      blockedArtists: state.neverArtists,
      buriedSongs: state.neverTracks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hooked-library.json";
    a.click();
    URL.revokeObjectURL(url);
  };

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

        <Group>appearance</Group>
        <div className="prefs-block">
          <span className="prefs-label">Accent</span>
          <Segmented<AccentMode>
            options={[
              { id: "track", label: "From each song" },
              { id: "custom", label: "Fixed colour" },
            ]}
            value={state.prefs.accentMode}
            onChange={(accentMode) => onSetPrefs({ accentMode })}
          />
          {state.prefs.accentMode === "custom" && (
            <div className="prefs-swatches" role="radiogroup" aria-label="accent colour">
              {ACCENT_SWATCHES.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={c.toUpperCase() === state.prefs.accentColor.toUpperCase()}
                  aria-label={`accent ${c}`}
                  className="prefs-swatch"
                  style={{ background: c, outlineColor: c }}
                  onClick={() => onSetPrefs({ accentColor: c })}
                />
              ))}
            </div>
          )}
          <span className="prefs-label">Motion</span>
          <Segmented<MotionLevel>
            options={MOTION_LEVELS}
            value={state.prefs.motion}
            onChange={(motion) => onSetPrefs({ motion })}
          />
        </div>

        <Group>playback</Group>
        <button className="settings-row" onClick={() => onAutoAdvance(!state.autoAdvance)}>
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
        <div className="settings-row" style={{ cursor: "default" }}>
          <span className="settings-row-icon">♪</span>
          <span className="settings-row-label">
            Volume
            <small>{Math.round(volume * 100)}%</small>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            aria-label="volume"
            className="prefs-range"
          />
        </div>

        <Group>gestures</Group>
        <div className="settings-row" style={{ cursor: "default" }}>
          <span className="settings-row-icon" style={{ color: "var(--save)" }}>✥</span>
          <span className="settings-row-label">
            Swipe distance
            <small>
              {state.prefs.swipeSensitivity < 0.9
                ? "feather-light flicks"
                : state.prefs.swipeSensitivity > 1.1
                  ? "deliberate drags"
                  : "the shipped default"}
            </small>
          </span>
          <input
            type="range"
            min={0.6}
            max={1.4}
            step={0.05}
            value={state.prefs.swipeSensitivity}
            onChange={(e) =>
              onSetPrefs({ swipeSensitivity: Number(e.target.value) })
            }
            aria-label="swipe distance sensitivity"
            className="prefs-range"
          />
        </div>
        <div className="prefs-block">
          <span className="prefs-label">Haptics</span>
          <Segmented<HapticsLevel>
            options={HAPTICS_LEVELS}
            value={state.prefs.haptics}
            onChange={(haptics) => onSetPrefs({ haptics })}
          />
        </div>

        <Group>sound &amp; taste</Group>
        <p className="prefs-hint">
          The deck tilts toward these answers without ever walling anything out.
        </p>
        <span className="prefs-label" style={{ marginTop: 4 }}>Languages</span>
        <div className="prefs-segmented" role="group" aria-label="languages">
          {options.languages.map((l) => (
            <button
              key={l.id}
              aria-pressed={taste.languages.includes(l.id)}
              className={`prefs-chip ${taste.languages.includes(l.id) ? "on" : ""}`}
              onClick={() => editTaste({ languages: toggleIn(taste.languages, l.id) })}
            >
              {l.label}
            </button>
          ))}
        </div>
        <span className="prefs-label">Genres</span>
        <div className="prefs-segmented" role="group" aria-label="genres">
          {options.genres.map((g) => (
            <button
              key={g.id}
              aria-pressed={taste.genres.includes(g.id)}
              className={`prefs-chip ${taste.genres.includes(g.id) ? "on" : ""}`}
              onClick={() => editTaste({ genres: toggleIn(taste.genres, g.id) })}
            >
              {g.label}
            </button>
          ))}
        </div>
        <span className="prefs-label">Adventure</span>
        <Segmented<Adventure>
          options={ADVENTURE.map((a) => ({ id: a.id, label: a.label }))}
          value={taste.adventure}
          onChange={(adventure) => editTaste({ adventure })}
        />

        <ReplayRules state={state} onReplay={onReplay} onUnbury={onUnbury} />

        {state.neverArtists.length > 0 && (
          <>
            <button className="settings-row" onClick={() => setShowBlocked((v) => !v)} aria-expanded={showBlocked}>
              <span className="settings-row-icon" style={{ color: "var(--never)" }}>✕</span>
              <span className="settings-row-label">
                Blocked artists ({state.neverArtists.length})
                <small>their songs never reach your deck</small>
              </span>
              <span className="settings-row-value">{showBlocked ? "hide" : "unblock"}</span>
            </button>
            {showBlocked &&
              state.neverArtists.slice(0, 50).map((a) => (
                <button key={a} className="settings-row" onClick={() => onUnblockArtist(a)}>
                  <span className="settings-row-icon">·</span>
                  <span className="settings-row-label">
                    {a}
                    <small>blocked</small>
                  </span>
                  <span className="settings-row-value" style={{ color: "var(--more)" }}>
                    unblock
                  </span>
                </button>
              ))}
          </>
        )}

        <Group>support hooked</Group>
        <div className="prefs-block">
          <span className="prefs-label">House ads</span>
          <p className="prefs-hint" style={{ marginTop: 2 }}>
            {state.prefs.adsOptOut
              ? "You've turned these off. Fair enough — they'll stay off until you change your mind."
              : adsConfig?.enabled
                ? `A small sponsored card every ~${adsConfig.everyNSwipes} swipes, at most ${adsConfig.maxPerDay} a day. Music never stops for one.`
                : "No cards are being shown right now."}
          </p>
          <div className="prefs-segmented" role="group" aria-label="house ads">
            <button
              className={`prefs-chip ${!state.prefs.adsOptOut ? "on" : ""}`}
              onClick={() => onSetPrefs({ adsOptOut: false })}
              aria-pressed={!state.prefs.adsOptOut}
            >
              On — keep hooked independent
            </button>
            <button
              className={`prefs-chip ${state.prefs.adsOptOut ? "on" : ""}`}
              onClick={() => {
                if (!state.prefs.adsOptOut) setAdsConfirm(true);
                else onSetPrefs({ adsOptOut: false });
              }}
              aria-pressed={state.prefs.adsOptOut}
            >
              Off
            </button>
          </div>
        </div>

        <Group>account</Group>
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
        <a className="settings-row" href="#/creator" style={{ textDecoration: "none" }}>
          <span className="settings-row-icon" style={{ color: "var(--more)" }}>♫</span>
          <span className="settings-row-label">
            Creator dashboard
            <small>put your own music in the deck</small>
          </span>
          <span className="settings-row-value">open</span>
        </a>
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

        <Group>data &amp; privacy</Group>
        <button className="settings-row" onClick={exportData}>
          <span className="settings-row-icon" style={{ color: "var(--more)" }}>↓</span>
          <span className="settings-row-label">
            Export my library
            <small>your lists and answers as JSON</small>
          </span>
          <span className="settings-row-value">save</span>
        </button>
        {/* the browser build is step 1 of the beta funnel — someone who has got
            this far has already swiped, which is exactly when the android ask
            is easiest to say yes to */}
        <a
          className="settings-row"
          href={BETA_URL}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "none" }}
        >
          <span className="settings-row-icon" style={{ color: "var(--save)" }}>↓</span>
          <span className="settings-row-label">
            Get it on your phone
            <small>join the android closed test</small>
          </span>
          <span className="settings-row-value">open</span>
        </a>
        <button className="settings-row" onClick={onReplayTutorial}>
          <span className="settings-row-icon">↻</span>
          <span className="settings-row-label">
            Replay the swipe tutorial
            <small>relearn the four gestures</small>
          </span>
        </button>
        <a
          className="settings-row"
          href="https://hookedcue.com/privacy"
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "none" }}
        >
          <span className="settings-row-icon">§</span>
          <span className="settings-row-label">
            Privacy &amp; terms
            <small>what we store, and how to get it deleted</small>
          </span>
          <span className="settings-row-value">open</span>
        </a>
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
        {session.data && (
          <button className="settings-row" onClick={removeAccount} disabled={deleting}>
            <span className="settings-row-icon" style={{ color: "var(--never)" }}>✕</span>
            <span className="settings-row-label" style={{ color: "var(--never)" }}>
              {deleting ? "Deleting…" : "Delete my account"}
              <small>removes your library, playlists and history for good</small>
            </span>
          </button>
        )}
      </motion.div>

      {/* the ask when someone turns ads off — honest, not guilt-trippy */}
      <AnimatePresence>
        {adsConfirm && (
          <>
            <motion.div
              className="sheet-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAdsConfirm(false)}
            />
            <motion.div
              className="sheet ad-ask"
              initial={{ y: "110%" }}
              animate={{ y: 0 }}
              exit={{ y: "110%" }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
            >
              <h3 className="sheet-title">Before you go…</h3>
              <p className="ad-ask-copy">
                hooked has no investors and no label money. Those few quiet cards
                between songs are what pay for the servers, the licences and the
                hours this takes. Turning them off won't cost you anything — but
                if a few hundred people do, this deck goes quiet with them.
              </p>
              <p className="ad-ask-copy">
                Whatever you choose, the music keeps playing. That's a promise.
              </p>
              <div className="ad-ask-actions">
                <button
                  className="prefs-chip on"
                  onClick={() => {
                    setAdsConfirm(false);
                    onSetPrefs({ adsOptOut: false });
                  }}
                >
                  Keep them on — I get it
                </button>
                <button
                  className="prefs-chip"
                  onClick={() => {
                    setAdsConfirm(false);
                    onSetPrefs({ adsOptOut: true });
                  }}
                >
                  Turn them off anyway
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
