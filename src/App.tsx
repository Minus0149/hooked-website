import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { coerceTaste } from "./data/taste";
import { coercePrefs } from "./data/prefs";
import type { UserPrefs } from "./data/prefs";
import { shouldAskForAd } from "./lib/ads-scheduler";
import { SponsoredCard, type AdCardData } from "./components/SponsoredCard";
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
import { ProfileScreen } from "./components/ProfileScreen";
import { AccessGate, AccessPending } from "./components/AccessGate";
// Staff-only screens. Split out so a listener never downloads the dashboards â€”
// between them they're a third of the bundle and nobody on the deck opens them.
const AdminDashboard = lazy(() =>
  import("./components/AdminDashboard").then((m) => ({ default: m.AdminDashboard })),
);
const CreatorDashboard = lazy(() =>
  import("./components/CreatorDashboard").then((m) => ({ default: m.CreatorDashboard })),
);
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
// saves are gated immediately â€” keeping a song is the account's whole pitch.
const ANON_SWIPES_KEY = "hooked.anonSwipes.v1";
const FREE_SWIPES = 5;

const TOAST_FOR: Record<SwipeDir, { msg: string; icon: string } | null> = {
  up: null,
  down: null, // the playlist-box animation is the save feedback
  right: { msg: "Finding more like this", icon: "âœ¦" },
  left: { msg: "Never again", icon: "âœ•" },
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

type ServerTrackWithHooks = ServerTrack & {
  audioUrl?: string | null;
  hooks?: { id: string; startMs: number; durationMs: number; label?: string }[];
  markets?: string[];
  heat?: number;
};

interface ServerLibrary {
  isAdmin: boolean;
  permissions: string[];
  taste?: unknown;
  prefs?: Partial<UserPrefs> | null;
}

const toLocal = (t: ServerTrackWithHooks): Track => ({
  audioUrl: t.audioUrl ?? undefined,
  hooks: t.hooks,
  markets: t.markets,
  heat: t.heat,
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
    setReplay,
    unbury,
    unblockArtist,
    setTaste,
    setPrefs,
    hydrateRemote,
    applyCatalog,
  } = useStore();
  // latest state without re-creating callbacks that read it (the debounced
  // prefs push below reads state.prefs at fire time, not capture time)
  const stateRef = useRef(state);
  stateRef.current = state;
  const [view, setView] = useState<View>("home");
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem(ONBOARD_KEY) === "1",
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  // bumped by â†© â€” cancels any in-flight save animation in the deck
  const [backToken, setBackToken] = useState(0);
  const [toast, setToast] = useState<{ key: number; msg: string; icon: string } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((msg: string, icon: string) => {
    window.clearTimeout(toastTimer.current);
    setToast({ key: Date.now(), msg, icon });
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);

  // Cloud writes used to fail in total silence (`.catch(() => undefined)`),
  // which read as "the app ate my save". Surface it â€” throttled so a burst of
  // failures shows one message, not eleven â€” while the local copy keeps the
  // action alive for when connectivity returns.
  const lastSyncWarn = useRef(0);
  const syncFailed = useCallback(() => {
    if (Date.now() - lastSyncWarn.current < 15_000) return;
    lastSyncWarn.current = Date.now();
    showToast("Cloud sync hiccuped â€” kept on this device", "âš ");
  }, [showToast]);

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

  // ensureProfile is the access gate: it refuses to create a profile until the
  // email has been approved, so a rejected/pending sign-in has to be surfaced
  // rather than swallowed.
  const [accessBlock, setAccessBlock] = useState<null | "pending" | "rejected" | "none">(null);
  useEffect(() => {
    if (!signedIn) {
      setAccessBlock(null);
      return;
    }
    void ensureProfile({})
      .then(() => setAccessBlock(null))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ACCESS_REJECTED")) setAccessBlock("rejected");
        else if (msg.includes("ACCESS_PENDING")) setAccessBlock("pending");
        else if (msg.includes("ACCESS_NOT_REQUESTED")) setAccessBlock("none");
      });
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
  // the reactive query (token refresh etc.) must not re-trigger hydration â€”
  // a mid-session re-hydrate rebuilds the queue under the user's fingers
  const setReplayMutation = useMutation(api.library.setReplayContainer);
  /** Local first so the toggle is instant; the server is the record of truth. */
  const handleReplay = useCallback(
    (container: string, allow: boolean) => {
      setReplay(container, allow);
      if (signedIn) {
        void setReplayMutation({ container, allow }).catch(syncFailed);
      }
    },
    [setReplay, signedIn, setReplayMutation, syncFailed],
  );

  const unburyMutation = useMutation(api.library.unburyTrack);
  const unblockArtistMutation = useMutation(api.library.unblockArtist);
  const setTasteMutation = useMutation(api.library.setTaste);
  const setPrefsMutation = useMutation(api.library.setPrefs);
  const recordAdEvent = useMutation(api.ads.recordEvent);

  const handleUnbury = useCallback(
    (trackId: string) => {
      unbury(trackId);
      if (signedIn) void unburyMutation({ trackId }).catch(syncFailed);
    },
    [unbury, signedIn, unburyMutation, syncFailed],
  );
  const handleUnblockArtist = useCallback(
    (artist: string) => {
      unblockArtist(artist);
      if (signedIn) void unblockArtistMutation({ artist }).catch(syncFailed);
    },
    [unblockArtist, signedIn, unblockArtistMutation, syncFailed],
 );

  /** Push pref changes to the profile, debounced so slider drags don't spam. */
  const prefsTimer = useRef<number | undefined>(undefined);
  const handleSetPrefs = useCallback(
    (p: Partial<UserPrefs>) => {
      setPrefs(p); // local-first: instant, works offline
      if (!signedIn) return;
      window.clearTimeout(prefsTimer.current);
      prefsTimer.current = window.setTimeout(() => {
        const merged = { ...stateRef.current.prefs, ...p };
        void setPrefsMutation({
          motion: merged.motion,
          haptics: merged.haptics,
          accentMode: merged.accentMode,
          accentColor: merged.accentColor,
          swipeSensitivity: merged.swipeSensitivity,
          adsOptOut: merged.adsOptOut,
        }).catch(syncFailed);
      }, 600);
    },
    [setPrefs, signedIn, setPrefsMutation, syncFailed],
  );

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
        neverTracks: library.neverTracks ?? [],
        replayContainers: library.replayContainers ?? [],
        taste: coerceTaste(library.taste),
        prefs: coercePrefs(library.prefs),
        saveTarget: library.saveTarget as SaveTarget,
      });
    }
  }, [library, sessionUid, hydrateRemote]);

  useEffect(() => {
    // An empty server catalogue is a real state (admin hid everything, or the
    // table is fresh) â€” honour it instead of dealing tracks the server buried.
    if (serverTracks !== undefined && serverTracks !== null) {
      // Full tracks, not just ids. Passing ids only meant the deck kept
      // dealing the bundled copies, so hooks, creator uploads and imported
      // songs never reached a card.
      applyCatalog(serverTracks.map(toLocal));
    }
  }, [serverTracks, applyCatalog]);

  // ----- playback -----
  // ----- house ads: server owns the caps, the deck owns the pacing -----
  //
  // A stable per-install key so anonymous visitors get a fair daily cap too.
  const anonKeyRef = useRef<string | null>(null);
  useEffect(() => {
    let k = localStorage.getItem("hooked.anon");
    if (!k) {
      k = `anon-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem("hooked.anon", k);
    }
    anonKeyRef.current = k;
  }, []);

  const adsConfig = useQuery(
    api.ads.getConfig,
    state.prefs.adsOptOut ? "skip" : {},
  ) as
    | { enabled: boolean; everyNSwipes: number; cooldownMinutes: number; maxPerDay: number }
    | null
    | undefined;

  const swipeCounter = useRef(0);
  const lastAdAt = useRef(0);
  const [adDue, setAdDue] = useState(false);
  const [activeAd, setActiveAd] = useState<AdCardData | null>(null);

  const handleSwipeForAds = useCallback(() => {
    swipeCounter.current += 1;
    const due = shouldAskForAd({
      swipesSinceAd: swipeCounter.current,
      now: Date.now(),
      lastAdAt: lastAdAt.current,
      optedOut: state.prefs.adsOptOut,
      config: adsConfig,
    });
    if (!due) return;
    setAdDue(true); // nextAd query wakes up and decides authoritatively
  }, [state.prefs.adsOptOut, adsConfig]);

  // authoritative selection â€” null means any cap said no
  const adCandidate = useQuery(
    api.ads.nextAd,
    adDue ? { userId: signedIn ? (sessionUid ?? undefined) : undefined, anonKey: anonKeyRef.current ?? undefined } : "skip",
  );

  useEffect(() => {
    if (!adDue || adCandidate === undefined) return;
    setAdDue(false);
    if (adCandidate) {
      lastAdAt.current = Date.now();
      swipeCounter.current = 0;
      setActiveAd(adCandidate as unknown as AdCardData);
      void recordAdEvent({
        adId: adCandidate.id as never,
        kind: "impression",
        userId: signedIn ? (sessionUid ?? undefined) : undefined,
        anonKey: anonKeyRef.current ?? undefined,
      }).catch(() => undefined);
    }
  }, [adDue, adCandidate, recordAdEvent, signedIn, sessionUid]);

  const closeActiveAd = useCallback(
    (kind: "click" | "skip") => {
      if (activeAd) {
        void recordAdEvent({
          adId: activeAd.id as never,
          kind,
          userId: signedIn ? (sessionUid ?? undefined) : undefined,
          anonKey: anonKeyRef.current ?? undefined,
        }).catch(() => undefined);
      }
      setActiveAd(null);
    },
    [activeAd, recordAdEvent, signedIn, sessionUid],
  );

  const onDeck = state.queue[0] ?? null;
  const next = state.queue[1] ?? null;
  const previous = state.history.length
    ? state.history[state.history.length - 1]
    : null;

  const inDiscover = view === "discover" && onboarded;
  const autoAdvanceRef = useRef(state.autoAdvance);
  autoAdvanceRef.current = state.autoAdvance;
  const {
    playing, progress, remaining, volume, toggle, seek, setVolume,
    hookIndex, hookCount, hook, nextHook,
  } = usePlayer(
    inDiscover ? onDeck : null,
    inDiscover ? next : null,
    inDiscover,
    () => {
      if (autoAdvanceRef.current) swipe("skip"); // preview ended â†’ next song
    },
    // the player already auto-skips dead audio; this is where it gets reported
    (src) => {
      console.warn(`[audio] source failed: ${src}`);
      showToast("That track's audio is gone â€” skipped", "âš ");
    },
  );

  const handleSwipe = useCallback(
    (dir: SwipeDir) => {
      const t = TOAST_FOR[dir];
      if (t) showToast(t.msg, t.icon);
      handleSwipeForAds();
      const track = onDeck;
      const action = DIR_TO_ACTION[dir];
      swipe(action);
      if (signedIn && track) {
        const playingHookId = hookRef.current?.id;
        // only server-issued Convex ids may be credited â€” the baked catalog's
        // synthetic ids ("123:0") and the "whole" fallback would fail
        // validation and turn every swipe on a cold start into a sync error
        const validHookId =
          playingHookId && /^[a-z0-9]{20,}$/.test(playingHookId)
            ? (playingHookId as never)
            : undefined;
        void recordSwipe({
          track: toServer(track),
          action,
          hookId: validHookId,
        }).catch(syncFailed);
      }
    },
    [swipe, showToast, onDeck, signedIn, recordSwipe, syncFailed, handleSwipeForAds],
  );

  const hookRef = useRef(hook);
  hookRef.current = hook;

  const handleBack = useCallback(() => {
    if (!previous) return;
    back();
    setBackToken((t) => t + 1);
    showToast("Brought back the last song", "â†©");
    // a re-like of an already-saved song added nothing, so there's nothing
    // to revert server-side (reverting would wrongly delete the library row)
    const noopSave = previous.action === "save" && !previous.savedToLibrary;
    if (signedIn && !noopSave) {
      void revertSwipe({
        trackId: previous.track.id,
        artist: previous.track.artist,
        action: previous.action,
      }).catch(syncFailed);
    }
  }, [back, previous, showToast, signedIn, revertSwipe, syncFailed]);

  const handleSaveTarget = useCallback(
    (target: SaveTarget) => {
      setSaveTarget(target);
      if (signedIn) void saveTargetMutation({ target }).catch(syncFailed);
    },
    [setSaveTarget, signedIn, saveTargetMutation, syncFailed],
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
      showToast(`Playlist "${name}" created`, "âœ¦");
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
      showToast("New saves land here now", "âœ¦");
    },
    [handleSaveTarget, showToast],
  );

  const handleDeletePlaylist = useCallback(
    (id: string) => {
      deletePlaylist(id);
      if (signedIn && !id.startsWith("local-")) {
        void deletePlaylistMutation({ playlistId: id as never }).catch(syncFailed);
      }
    },
    [deletePlaylist, signedIn, deletePlaylistMutation, syncFailed],
  );

  const handleRemoveSong = useCallback(
    (trackId: string) => {
      removeSong(trackId);
      if (signedIn) void removeSongMutation({ trackId }).catch(syncFailed);
    },
    [removeSong, signedIn, removeSongMutation, syncFailed],
  );

  // The tutorial deals from cards 4â€“8. On a thin queue that slice can come
  // back with fewer than four â€” or zero â€” and `index % 0` is NaN, which made
  // the demo card read `.artwork` of undefined and crash onboarding entirely.
  const demoTracks = useMemo(() => {
    const fromQueue = state.queue.slice(3, 8);
    if (fromQueue.length >= 5) return fromQueue;
    const used = new Set(
      [...state.queue.slice(0, 3), ...fromQueue].map((t) => t.id),
    );
    const extra = state.catalog
      .filter((t) => !used.has(t.id))
      .slice(0, 5 - fromQueue.length);
    return [...fromQueue, ...extra];
  }, [state.queue, state.catalog]);

  const goDiscover = useCallback(
    (trackId?: string) => {
      if (trackId) jumpTo(trackId);
      setView("discover");
    },
    [jumpTo],
  );

  // tint the whole room with the on-deck track's accent â€” or a fixed colour
  // if they chose one in Settings â†’ Appearance
  const trackAccent = inDiscover && onDeck ? onDeck.accent : "#FF3D71";
  const accent =
    state.prefs.accentMode === "custom" ? state.prefs.accentColor : trackAccent;
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
  }, [accent]);

  // motion preference rides a data attribute so CSS can gate its loops
  useEffect(() => {
    document.documentElement.dataset.motion = state.prefs.motion;
    return () => {
      delete document.documentElement.dataset.motion;
    };
  }, [state.prefs.motion]);

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
                hookIndex={hookIndex}
                hookCount={hookCount}
                hookLabel={hook?.label}
                onNextHook={nextHook}
                gateSwipe={gateSwipe}
                sensitivity={state.prefs.swipeSensitivity}
                motionPref={state.prefs.motion}
              />
              {/* house ad between swipes â€” music keeps playing under it */}
              <AnimatePresence>
                {activeAd && (
                  <SponsoredCard
                    ad={activeAd}
                    onSkip={() => closeActiveAd("skip")}
                    onClick={() => closeActiveAd("click")}
                    onWhy={() => {
                      setActiveAd(null);
                      setView("settings");
                    }}
                  />
                )}
              </AnimatePresence>
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
              onReplay={handleReplay}
              onUnbury={handleUnbury}
              onUnblockArtist={handleUnblockArtist}
              onSetPrefs={handleSetPrefs}
              adsConfig={adsConfig ?? null}
              volume={volume}
              onVolume={setVolume}
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

        {accessBlock && <AccessPending reason={accessBlock} />}

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
                <AccessGate freeSwipes={FREE_SWIPES} />
                <button className="gate-close" onClick={() => setGate(null)}>
                  not now â€” just looking
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
              demoTracks={demoTracks}
              demoCatalog={state.catalog}
              onFinish={(taste) => {
                localStorage.setItem(ONBOARD_KEY, "1");
                // apply locally first so the very first deck is already tilted;
                // the server copy is for the next device they sign in on
                setTaste(taste);
                if (signedIn) void setTasteMutation(taste).catch(syncFailed);
                setOnboarded(true);
                setView("discover"); // this tap unlocks audio autoplay
              }}
            />
          )}
        </AnimatePresence>
      </div>
      <VolumeRail volume={volume} onVolume={setVolume} visible={inDiscover} />
      </div>
      {/* a hint about the deck, so it belongs only on the deck â€” it was
          rendering at the app root and sitting over home, the library and
          settings, where it means nothing and overlaps real rows */}
      {inDiscover && (
        <p className="stage-caption">
          drag the card Â· arrow keys work too Â· space to pause
        </p>
      )}
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

  if (route.startsWith("#/admin") || route.startsWith("#/creator")) {
    const Screen = route.startsWith("#/admin") ? AdminDashboard : CreatorDashboard;
    return (
      <Suspense
        fallback={<div className="admin admin-v2"><p className="admin-empty">Loadingâ€¦</p></div>}
      >
        <Screen />
      </Suspense>
    );
  }
  // anything else under #/ that isn't a real route gets the 404 — silently
  // rendering the deck for a mistyped link hid the mistake
  if (route.startsWith("#/") && route !== "#/" && route !== "#" && route !== "") {
    return (
      <div className="notfound">
        <span className="wordmark">
          hooked<span className="dot">.</span>
        </span>
        <h1>404</h1>
        <p>That page doesn&apos;t exist. The songs are all still where you left them.</p>
        <a className="notfound-home" href="#/">back to the deck</a>
      </div>
    );
  }

  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
