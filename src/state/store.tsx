import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { Playlist, SaveTarget, SwipeAction, Track } from "../types";
import catalogJson from "../data/catalog.json";

const CATALOG = catalogJson as Track[];
const PERSIST_KEY = "hooked.library.v2";

export interface HistoryEntry {
  track: Track;
  action: SwipeAction;
  // true only when a "save" actually added the track to the library —
  // re-liking an already-saved song must not remove it on revert
  savedToLibrary?: boolean;
}

export interface AppState {
  queue: Track[]; // queue[0] is the track on deck
  history: HistoryEntry[];
  liked: Track[];
  discoveries: Track[];
  playlists: Playlist[];
  neverArtists: string[];
  boostGenres: string[];
  saveTarget: SaveTarget;
  autoAdvance: boolean; // keep playing the next song when a preview ends
  // server-allowed track ids (admin can hide tracks); null until known —
  // refills must respect this or hidden tracks get re-dealt
  allowedIds: string[] | null;
}

type Action =
  | { type: "SWIPE"; action: SwipeAction }
  | { type: "BACK" }
  | { type: "JUMP_TO"; trackId: string }
  | { type: "SET_SAVE_TARGET"; target: SaveTarget }
  | { type: "SET_AUTO_ADVANCE"; value: boolean }
  | { type: "CREATE_PLAYLIST"; playlist: Playlist }
  | { type: "DELETE_PLAYLIST"; id: string }
  | { type: "REMOVE_SONG"; trackId: string }
  | {
      // replaces the local library with the signed-in user's cloud library
      type: "HYDRATE_REMOTE";
      liked: Track[];
      discoveries: Track[];
      playlists: Playlist[];
      neverArtists: string[];
      saveTarget: SaveTarget;
    }
  | {
      // server catalog arrived: drop tracks an admin has hidden
      type: "APPLY_CATALOG";
      ids: string[];
    };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<
      Pick<
        AppState,
        | "liked"
        | "discoveries"
        | "playlists"
        | "neverArtists"
        | "saveTarget"
        | "boostGenres"
        | "autoAdvance"
      >
    >;
  } catch {
    return null;
  }
}

function buildQueue(exclude: Set<string>, neverArtists: string[]): Track[] {
  const fresh = CATALOG.filter(
    (t) => !exclude.has(t.id) && !neverArtists.includes(t.artist),
  );
  // If the user has heard everything, loop the catalog rather than dead-ending
  const pool = fresh.length > 4 ? fresh : CATALOG.filter((t) => !neverArtists.includes(t.artist));
  return shuffle(pool);
}

function libraryIds(state: Pick<AppState, "liked" | "discoveries" | "playlists">) {
  return new Set(
    [
      ...state.liked,
      ...state.discoveries,
      ...state.playlists.flatMap((p) => p.tracks),
    ].map((t) => t.id),
  );
}

/**
 * Queue invariant: every track id appears at most once. Duplicate ids break
 * React's keyed card stack ("two children with the same key") which renders
 * as duplicated/stale card images — this guard makes that impossible.
 */
function uniqueById(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

/**
 * Many catalog tracks share one album's artwork. Two of those back-to-back
 * look like "the card didn't change" even when everything works — push
 * same-artwork neighbors apart. Never moves index 0 (the visible card).
 */
function spreadAlbums(tracks: Track[]): Track[] {
  const out = [...tracks];
  for (let i = 1; i < out.length; i++) {
    if (out[i].artwork === out[i - 1].artwork) {
      const j = out.findIndex((t, k) => k > i && t.artwork !== out[i - 1].artwork);
      if (j > i) [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

function initState(): AppState {
  const saved = loadPersisted();
  const liked = uniqueById(saved?.liked ?? []);
  const discoveries = uniqueById(saved?.discoveries ?? []);
  const playlists = (saved?.playlists ?? []).map((p) => ({
    ...p,
    tracks: uniqueById(p.tracks),
  }));
  const neverArtists = saved?.neverArtists ?? [];
  const inLibrary = libraryIds({ liked, discoveries, playlists });
  return {
    queue: spreadAlbums(buildQueue(inLibrary, neverArtists)),
    history: [],
    liked,
    discoveries,
    playlists,
    neverArtists,
    boostGenres: saved?.boostGenres ?? [],
    saveTarget: saved?.saveTarget ?? "liked",
    autoAdvance: saved?.autoAdvance ?? true,
    allowedIds: null,
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SWIPE": {
      const current = state.queue[0];
      if (!current) return state;
      let rest = state.queue.slice(1);
      let { liked, discoveries, playlists, neverArtists, boostGenres } = state;

      const savedToLibrary =
        action.action === "save" && !libraryIds(state).has(current.id);
      if (savedToLibrary) {
        if (state.saveTarget === "liked") {
          liked = [current, ...liked];
        } else if (state.saveTarget === "discoveries") {
          discoveries = [current, ...discoveries];
        } else {
          const plId = state.saveTarget.slice(3);
          const found = playlists.some((p) => p.id === plId);
          if (found) {
            playlists = playlists.map((p) =>
              p.id === plId ? { ...p, tracks: [current, ...p.tracks] } : p,
            );
          } else {
            liked = [current, ...liked]; // target playlist vanished — fall back
          }
        }
      }
      if (action.action === "more") {
        // keep the visible peek card in place — re-ranking the card the user
        // can already see reads as photos jumping around
        const [peek, ...tail] = rest;
        const similar = tail.filter(
          (t) => t.genre === current.genre || t.artist === current.artist,
        );
        const others = tail.filter(
          (t) => t.genre !== current.genre && t.artist !== current.artist,
        );
        rest = peek
          ? [peek, ...shuffle(similar), ...others]
          : [...shuffle(similar), ...others];
        boostGenres = [
          current.genre,
          ...boostGenres.filter((g) => g !== current.genre),
        ].slice(0, 3);
      }
      if (action.action === "never") {
        neverArtists = neverArtists.includes(current.artist)
          ? neverArtists
          : [...neverArtists, current.artist];
        rest = rest.filter((t) => t.artist !== current.artist);
      }
      // top up BEFORE the queue runs dry (the deck shows 3 cards), and never
      // refill with the just-swiped track, anything already queued, or
      // recently seen songs — re-dealing the same card right back was the
      // "old image appears again" glitch (and, with ↩, duplicate queue ids)
      if (rest.length < 3) {
        const inLibrary = libraryIds({ liked, discoveries, playlists });
        const allowed = state.allowedIds ? new Set(state.allowedIds) : null;
        const avoid = new Set([
          current.id,
          ...rest.map((t) => t.id),
          ...state.history.slice(-12).map((h) => h.track.id),
        ]);
        // refills must skip admin-hidden tracks too
        const pickable = CATALOG.filter((t) => !allowed || allowed.has(t.id));
        const fresh = pickable.filter(
          (t) =>
            !inLibrary.has(t.id) &&
            !neverArtists.includes(t.artist) &&
            !avoid.has(t.id),
        );
        const seenAgain = pickable.filter(
          (t) => !neverArtists.includes(t.artist) && !avoid.has(t.id),
        );
        const lastResort = pickable.filter(
          (t) => t.id !== current.id && !neverArtists.includes(t.artist),
        );
        const pool =
          fresh.length >= 3 ? fresh : seenAgain.length > 0 ? seenAgain : lastResort;
        rest = [...rest, ...shuffle(pool)];
      }
      return {
        ...state,
        queue: spreadAlbums(uniqueById(rest)),
        history: [
          ...state.history,
          { track: current, action: action.action, savedToLibrary },
        ].slice(-50),
        liked,
        discoveries,
        playlists,
        neverArtists,
        boostGenres,
      };
    }

    case "BACK": {
      const last = state.history[state.history.length - 1];
      if (!last) return state;
      let { liked, discoveries, playlists, neverArtists } = state;
      // Going back also reverts what the swipe did, so the user can re-decide —
      // but only if that save actually added the track (a re-like of an
      // already-saved song must not strip it from the library)
      if (last.action === "save" && last.savedToLibrary) {
        liked = liked.filter((t) => t.id !== last.track.id);
        discoveries = discoveries.filter((t) => t.id !== last.track.id);
        playlists = playlists.map((p) => ({
          ...p,
          tracks: p.tracks.filter((t) => t.id !== last.track.id),
        }));
      }
      if (last.action === "never") {
        neverArtists = neverArtists.filter((a) => a !== last.track.artist);
      }
      return {
        ...state,
        queue: uniqueById([last.track, ...state.queue]),
        history: state.history.slice(0, -1),
        liked,
        discoveries,
        playlists,
        neverArtists,
      };
    }

    case "CREATE_PLAYLIST":
      return { ...state, playlists: [...state.playlists, action.playlist] };

    case "DELETE_PLAYLIST": {
      const saveTarget =
        state.saveTarget === `pl:${action.id}` ? "liked" : state.saveTarget;
      return {
        ...state,
        playlists: state.playlists.filter((p) => p.id !== action.id),
        saveTarget,
      };
    }

    case "REMOVE_SONG":
      return {
        ...state,
        liked: state.liked.filter((t) => t.id !== action.trackId),
        discoveries: state.discoveries.filter((t) => t.id !== action.trackId),
        playlists: state.playlists.map((p) => ({
          ...p,
          tracks: p.tracks.filter((t) => t.id !== action.trackId),
        })),
      };

    case "SET_AUTO_ADVANCE":
      return { ...state, autoAdvance: action.value };

    case "JUMP_TO": {
      const target =
        state.queue.find((t) => t.id === action.trackId) ??
        CATALOG.find((t) => t.id === action.trackId);
      if (!target) return state;
      return {
        ...state,
        queue: uniqueById([target, ...state.queue]),
      };
    }

    case "SET_SAVE_TARGET":
      return { ...state, saveTarget: action.target };

    case "HYDRATE_REMOTE": {
      const inLibrary = libraryIds(action);
      // keep the card the user is looking at — yanking queue[0] mid-session
      // swaps the visible card/audio under their thumb
      const [head, ...restQ] = state.queue;
      let queue = [
        ...(head ? [head] : []),
        ...restQ.filter(
          (t) => !inLibrary.has(t.id) && !action.neverArtists.includes(t.artist),
        ),
      ];
      // filter-only hydration could leave the deck thin or permanently EMPTY
      // (SWIPE's refill is unreachable with an empty queue) — top it up here
      if (queue.length < 3) {
        const queued = new Set(queue.map((t) => t.id));
        const allowed = state.allowedIds ? new Set(state.allowedIds) : null;
        const pickable = CATALOG.filter((t) => !allowed || allowed.has(t.id));
        const fresh = pickable.filter(
          (t) =>
            !inLibrary.has(t.id) &&
            !action.neverArtists.includes(t.artist) &&
            !queued.has(t.id),
        );
        const fallback = pickable.filter(
          (t) => !action.neverArtists.includes(t.artist) && !queued.has(t.id),
        );
        queue = [...queue, ...shuffle(fresh.length >= 3 ? fresh : fallback)];
      }
      return {
        ...state,
        liked: uniqueById(action.liked),
        discoveries: uniqueById(action.discoveries),
        playlists: action.playlists.map((p) => ({ ...p, tracks: uniqueById(p.tracks) })),
        neverArtists: action.neverArtists,
        saveTarget: action.saveTarget,
        queue: spreadAlbums(uniqueById(queue)),
        // keep history: clearing it killed the ↩ button at every sign-in
      };
    }

    case "APPLY_CATALOG": {
      const allowed = new Set(action.ids);
      const queue = state.queue.filter((t) => allowed.has(t.id));
      // idempotent: if nothing was hidden, return the SAME state object
      // (apart from recording allowedIds once) — a fresh object every
      // dispatch fed the render loop
      const sameQueue = queue.length === state.queue.length || queue.length === 0;
      const sameIds =
        state.allowedIds !== null &&
        state.allowedIds.length === action.ids.length &&
        state.allowedIds.every((id, i) => id === action.ids[i]);
      if (sameQueue && sameIds) return state;
      return {
        ...state,
        allowedIds: action.ids,
        queue: sameQueue ? state.queue : queue,
      };
    }
  }
}

interface StoreValue {
  state: AppState;
  swipe: (action: SwipeAction) => void;
  back: () => void;
  jumpTo: (trackId: string) => void;
  setSaveTarget: (target: SaveTarget) => void;
  createPlaylist: (playlist: Playlist) => void;
  deletePlaylist: (id: string) => void;
  removeSong: (trackId: string) => void;
  setAutoAdvance: (value: boolean) => void;
  hydrateRemote: (payload: {
    liked: Track[];
    discoveries: Track[];
    playlists: Playlist[];
    neverArtists: string[];
    saveTarget: SaveTarget;
  }) => void;
  applyCatalog: (ids: string[]) => void;
  catalog: Track[];
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  useEffect(() => {
    const { liked, discoveries, playlists, neverArtists, saveTarget, boostGenres, autoAdvance } = state;
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ liked, discoveries, playlists, neverArtists, saveTarget, boostGenres, autoAdvance }),
    );
  }, [state.liked, state.discoveries, state.playlists, state.neverArtists, state.saveTarget, state.boostGenres, state.autoAdvance]);

  // CRITICAL: actions are memoized once (dispatch is stable). They must NOT
  // be recreated per state change — effects depend on these functions, and
  // changing identities re-fire the effects, which dispatch again → an
  // infinite "Maximum update depth exceeded" render loop.
  const actions = useMemo(
    () => ({
      swipe: (action: SwipeAction) => dispatch({ type: "SWIPE", action }),
      back: () => dispatch({ type: "BACK" }),
      jumpTo: (trackId: string) => dispatch({ type: "JUMP_TO", trackId }),
      setSaveTarget: (target: SaveTarget) => dispatch({ type: "SET_SAVE_TARGET", target }),
      createPlaylist: (playlist: Playlist) => dispatch({ type: "CREATE_PLAYLIST", playlist }),
      deletePlaylist: (id: string) => dispatch({ type: "DELETE_PLAYLIST", id }),
      removeSong: (trackId: string) => dispatch({ type: "REMOVE_SONG", trackId }),
      setAutoAdvance: (value: boolean) => dispatch({ type: "SET_AUTO_ADVANCE", value }),
      hydrateRemote: (payload: {
        liked: Track[];
        discoveries: Track[];
        playlists: Playlist[];
        neverArtists: string[];
        saveTarget: SaveTarget;
      }) => dispatch({ type: "HYDRATE_REMOTE", ...payload }),
      applyCatalog: (ids: string[]) => dispatch({ type: "APPLY_CATALOG", ids }),
    }),
    [],
  );

  const value = useMemo<StoreValue>(
    () => ({ state, ...actions, catalog: CATALOG }),
    [state, actions],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
