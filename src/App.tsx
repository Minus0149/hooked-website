import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { authClient } from "./lib/auth-client";
import { StoreProvider, useStore } from "./state/store";
import { usePlayer } from "./audio/usePlayer";
import { SwipeDeck } from "./components/SwipeDeck";
import { TopBar } from "./components/TopBar";
import { BottomNav } from "./components/BottomNav";
import { HomeScreen } from "./components/HomeScreen";
import { Onboarding } from "./components/Onboarding";
import { SaveTargetSheet } from "./components/SaveTargetSheet";
import { VolumeRail } from "./components/VolumeControl";
import { ProfileScreen, AuthForm } from "./components/ProfileScreen";
import { AdminDashboard } from "./components/AdminDashboard";
import { LibraryScreen } from "./components/LibraryScreen";
import { SettingsScreen } from "./components/SettingsScreen";
import { NewPlaylistSheet } from "./components/NewPlaylistSheet";
import { IconSettings, IconUser } from "./components/icons";
import {
  DIR_TO_ACTION,
  type LibraryContainer,
  type SaveTarget,
  type SwipeDir,
  type Track,
} from "./types";

const ONBOARD_KEY = "hooked.onboarded.v1";
// taste-first gate: anonymous visitors get a few free swipes, then the wall.
// saves are gated immediately — keeping a song is the account's whole pitch.
const ANON_SWIPES_KEY = "hooked.anonSwipes.v1";
const FREE_SWIPES = 5;

const TOAST_FOR: Record<SwipeDir, { msg: string; icon: string } | null> = {
  up: null,
  down: null, // the playlist-box animation is the save feedback
  right: { msg: "Finding more like this", icon: "✦" },
  left: { msg: "Never again", icon: "✕" },
};

type View = "home" | "discover" | "profile" | "settings" | `library:${string}`;

interface ServerTrack {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  previewUrl: string;
  durationMs: number;
  genre: string;
  accent: string;
}

const toServer = (t: Track): ServerTrack => ({
  trackId: t.id,
  title: t.title,
  artist: t.artist,
  album: t.album,
  artwork: t.artwork,
  previewUrl: t.previewUrl,
  durationMs: t.durationMs,
  genre: t.genre,
  accent: t.accent,
});

const toLocal = (t: ServerTrack): Track => ({
  id: t.trackId,
  title: t.title,
  artist: t.artist,
  album: t.album,
  artwork: t.artwork,
  previewUrl: t.previewUrl,
  durationMs: t.durationMs,
  genre: t.genre,
  accent: t.accent,
});

function Shell() {
  const {
    state,
    swipe,
    back,
    jumpTo,
    setSaveTarget,
    createPlaylist,
    deletePlaylist,
    removeSong,
    setAutoAdvance,
    hydrateRemote,
    applyCatalog,
  } = useStore();
  const [view, setView] = useState<View>("home");
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem(ONBOARD_KEY) === "1",
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  // bumped by ↩ — cancels any in-flight save animation in the deck
  const [backToken, setBackToken] = useState(0);
  const [toast, setToast] = useState<{ key: number; msg: string; icon: string } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  // ----- cloud sync -----
  const session = authClient.useSession();
  const signedIn = !!session.data;
  const library = useQuery(api.library.getLibrary);
  const serverTracks = useQuery(api.tracks.list);
  const ensureProfile = useMutation(api.library.ensureProfile);
  const recordSwipe = useMutation(api.library.recordSwipe);
  const revertSwipe = useMutation(api.library.revertSwipe);
  const saveTargetMutation = useMutation(api.library.setSaveTarget);
  const createPlaylistMutation = useMutation(api.library.createPlaylist);
  const deletePlaylistMutation = useMutation(api.library.deletePlaylist);
  const removeSongMutation = useMutation(api.library.removeSong);

  useEffect(() => {
    if (signedIn) void ensureProfile({}).catch(() => undefined);
  }, [signedIn, ensureProfile]);

  // ----- taste-first login gate -----
  const [gate, setGate] = useState<null | "save" | "limit">(null);
  useEffect(() => {
    if (signedIn) {
      setGate(null);
      localStorage.removeItem(ANON_SWIPES_KEY);
    }
  }, [signedIn]);
  const gateSwipe = useCallback(
    (dir: SwipeDir): boolean => {
      if (signedIn) return true;
      if (dir === "down") {
        setGate("save");
        return false;
      }
      const used = Number(localStorage.getItem(ANON_SWIPES_KEY)) || 0;
      if (used >= FREE_SWIPES) {
        setGate("limit");
        return false;
      }
      localStorage.setItem(ANON_SWIPES_KEY, String(used + 1));
      return true;
    },
    [signedIn],
  );

  // keyed by user id, NOT by query nullability: a transient null frame from
  // the reactive query (token refresh etc.) must not re-trigger hydration —
  // a mid-session re-hydrate rebuilds the queue under the user's fingers
  const hydratedFor = useRef<string | null>(null);
  const sessionUid = session.data?.user?.id ?? null;
  useEffect(() => {
    if (!sessionUid) {
      hydratedFor.current = null; // truly signed out
      return;
    }
    if (library && hydratedFor.current !== sessionUid) {
      hydratedFor.current = sessionUid;
      hydrateRemote({
        liked: library.liked.map(toLocal),
        discoveries: library.discoveries.map(toLocal),
        playlists: library.playlists.map((p) => ({
          id: String(p.id),
          name: p.name,
          accent: p.accent,
          tracks: p.songs.map(toLocal),
        })),
        neverArtists: library.neverArtists,
        saveTarget: library.saveTarget as SaveTarget,
      });
    }
  }, [library, sessionUid, hydrateRemote]);

  useEffect(() => {
    if (serverTracks && serverTracks.length > 0) {
      applyCatalog(serverTracks.map((t) => t.trackId));
    }
  }, [serverTracks, applyCatalog]);

  // ----- playback -----
  const onDeck = state.queue[0] ?? null;
  const next = state.queue[1] ?? null;
  const previous = state.history.length
    ? state.history[state.history.length - 1]
    : null;

  const inDiscover = view === "discover" && onboarded;
  const autoAdvanceRef = useRef(state.autoAdvance);
  autoAdvanceRef.current = state.autoAdvance;
  const { playing, progress, remaining, volume, toggle, seek, setVolume } = usePlayer(
    inDiscover ? onDeck : null,
    inDiscover ? next : null,
    inDiscover,
    () => {
      if (autoAdvanceRef.current) swipe("skip"); // preview ended → next song
    },
  );

  const showToast = useCallback((msg: string, icon: string) => {
    window.clearTimeout(toastTimer.current);
    setToast({ key: Date.now(), msg, icon });
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);

  const handleSwipe = useCallback(
    (dir: SwipeDir) => {
      const t = TOAST_FOR[dir];
      if (t) showToast(t.msg, t.icon);
      const track = onDeck;
      const action = DIR_TO_ACTION[dir];
      swipe(action);
      if (signedIn && track) {
        void recordSwipe({ track: toServer(track), action }).catch(() => undefined);
      }
    },
    [swipe, showToast, onDeck, signedIn, recordSwipe],
  );

  const handleBack = useCallback(() => {
    if (!previous) return;
    back();
    setBackToken((t) => t + 1);
    showToast("Brought back the last song", "↩");
    // a re-like of an already-saved song added nothing, so there's nothing
    // to revert server-side (reverting would wrongly delete the library row)
    const noopSave = previous.action === "save" && !previous.savedToLibrary;
    if (signedIn && !noopSave) {
      void revertSwipe({
        trackId: previous.track.id,
        artist: previous.track.artist,
        action: previous.action,
      }).catch(() => undefined);
    }
  }, [back, previous, showToast, signedIn, revertSwipe]);

  const handleSaveTarget = useCallback(
    (target: SaveTarget) => {
      setSaveTarget(target);
      if (signedIn) void saveTargetMutation({ target }).catch(() => undefined);
    },
    [setSaveTarget, signedIn, saveTargetMutation],
  );

  const handleCreatePlaylist = useCallback(
    async (name: string, accent: string): Promise<string> => {
      let id = `local-${Date.now()}`;
      if (signedIn) {
        try {
          id = String(await createPlaylistMutation({ name, accent }));
        } catch {
          /* keep local id */
        }
      }
      createPlaylist({ id, name, accent, tracks: [] });
      showToast(`Playlist "${name}" created`, "✦");
      return id;
    },
    [signedIn, createPlaylistMutation, createPlaylist, showToast],
  );

  /** FAB flow: create the playlist AND make it the swipe-down destination. */
  const handleCreateAndTarget = useCallback(
    async (name: string, accent: string) => {
      const id = await handleCreatePlaylist(name, accent);
      handleSaveTarget(`pl:${id}`);
    },
    [handleCreatePlaylist, handleSaveTarget],
  );

  /** "Discover into this": point saves at the container, then go swipe. */
  const handleDiscoverInto = useCallback(
    (container: LibraryContainer) => {
      handleSaveTarget(container as SaveTarget);
      setView("discover");
      showToast("New saves land here now", "✦");
    },
    [handleSaveTarget, showToast],
  );

  const handleDeletePlaylist = useCallback(
    (id: string) => {
      deletePlaylist(id);
      if (signedIn && !id.startsWith("local-")) {
        void deletePlaylistMutation({ playlistId: id as never }).catch(() => undefined);
      }
    },
    [deletePlaylist, signedIn, deletePlaylistMutation],
  );

  const handleRemoveSong = useCallback(
    (trackId: string) => {
      removeSong(trackId);
      if (signedIn) void removeSongMutation({ trackId }).catch(() => undefined);
    },
    [removeSong, signedIn, removeSongMutation],
  );

  const goDiscover = useCallback(
    (trackId?: string) => {
      if (trackId) jumpTo(trackId);
      setView("discover");
    },
    [jumpTo],
  );

  // tint the whole room with the on-deck track's accent
  useEffect(() => {
    const accent = inDiscover && onDeck ? onDeck.accent : "#FF3D71";
    document.documentElement.style.setProperty("--accent", accent);
  }, [inDiscover, onDeck?.accent]);

  return (
    <div className="stage">
      <div className="phone-wrap">
      <div className="phone">
        <div className="screen">
          {view === "home" && (
            <>
              <header className="topbar">
                <button
                  className="topbar-btn"
                  onClick={() => setView("profile")}
                  aria-label="Profile"
                  style={signedIn ? { color: "var(--accent)" } : undefined}
                >
                  <IconUser />
                </button>
                <span className="wordmark">
                  hooked<span className="dot">.</span>
                </span>
                <button
                  className="topbar-btn"
                  onClick={() => setView("settings")}
                  aria-label="Settings"
                >
                  <IconSettings />
                </button>
              </header>
              <HomeScreen
                onDiscover={goDiscover}
                onOpenLibrary={(c) => setView(`library:${c}`)}
                onNewPlaylist={() => setNewPlaylistOpen(true)}
              />
            </>
          )}
          {view === "discover" && (
            <>
              <TopBar
                previous={previous?.track ?? null}
                onBack={handleBack}
                saveTarget={state.saveTarget}
                onOpenSettings={() => setSheetOpen(true)}
              />
              <SwipeDeck
                tracks={state.queue.slice(0, 3)}
                backToken={backToken}
                playing={playing}
                progress={progress}
                remaining={remaining}
                saveTarget={state.saveTarget}
                onToggle={toggle}
                onSeek={seek}
                onSwipe={handleSwipe}
                gateSwipe={gateSwipe}
              />
            </>
          )}
          {view === "profile" && (
            <ProfileScreen
              isAdmin={library?.isAdmin ?? false}
              onBack={() => setView("home")}
            />
          )}
          {view === "settings" && (
            <SettingsScreen
              isAdmin={(library?.isAdmin || (library?.permissions?.length ?? 0) > 0) ?? false}
              onBack={() => setView("home")}
              onOpenProfile={() => setView("profile")}
              onOpenSaveTarget={() => setSheetOpen(true)}
              onAutoAdvance={setAutoAdvance}
              onReplayTutorial={() => {
                localStorage.removeItem(ONBOARD_KEY);
                setOnboarded(false);
              }}
            />
          )}
          {view.startsWith("library:") && (
            <LibraryScreen
              container={view.slice(8) as LibraryContainer}
              onBack={() => setView("home")}
              onPlay={(id) => goDiscover(id)}
              onRemove={handleRemoveSong}
              onDeletePlaylist={handleDeletePlaylist}
              onDiscoverInto={handleDiscoverInto}
            />
          )}
          <BottomNav
            view={view === "discover" ? "discover" : "home"}
            showCreate={view === "home"}
            onChange={(v) => setView(v)}
            onCreate={() => setNewPlaylistOpen(true)}
          />
        </div>

        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.key}
              className="toast"
              initial={{ opacity: 0, y: -16, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -16, x: "-50%" }}
            >
              <span style={{ color: "var(--accent)" }}>{toast.icon}</span>
              {toast.msg}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {gate && !signedIn && (
            <motion.div
              className="gate-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="gate-card"
                initial={{ opacity: 0, y: 40, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 30, scale: 0.97 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="gate-kicker">
                  {gate === "save" ? "that one's a keeper" : "hooked already? thought so."}
                </p>
                <p className="gate-copy">
                  {gate === "save"
                    ? "create a free account and every save follows you everywhere — phone, browser, forever."
                    : `that was your ${FREE_SWIPES} free tastes. make an account and the deck never stops.`}
                </p>
                <AuthForm />
                <button className="gate-close" onClick={() => setGate(null)}>
                  not now — just looking
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {newPlaylistOpen && (
            <NewPlaylistSheet
              onCreate={handleCreateAndTarget}
              onClose={() => setNewPlaylistOpen(false)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {sheetOpen && (
            <SaveTargetSheet
              value={state.saveTarget}
              playlists={state.playlists}
              onChange={handleSaveTarget}
              onCreatePlaylist={handleCreatePlaylist}
              onClose={() => setSheetOpen(false)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {!onboarded && (
            <Onboarding
              demoTracks={state.queue.slice(3, 8)}
              onFinish={() => {
                localStorage.setItem(ONBOARD_KEY, "1");
                setOnboarded(true);
                setView("discover"); // this tap unlocks audio autoplay
              }}
            />
          )}
        </AnimatePresence>
      </div>
      <VolumeRail volume={volume} onVolume={setVolume} visible={inDiscover} />
      </div>
      <p className="stage-caption">
        drag the card · arrow keys work too · space to pause
      </p>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route.startsWith("#/admin")) {
    return <AdminDashboard />;
  }

  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
