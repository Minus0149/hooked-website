import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { Track } from "../types";
import { art } from "../lib/art";
import { searchSongs } from "../lib/songSearch";
import { IconBack } from "./icons";
import { useT } from "../lib/lang";

/**
 * Find a song in the deck by title, artist or album. The catalogue is already
 * on the device, so results come with every keystroke and nothing is fetched
 * (src/lib/songSearch.ts). Tapping a result plays it from its hook.
 */
export function SearchScreen({ onBack, onPlay }: { onBack: () => void; onPlay: (track: Track) => void }) {
  const tt = useT();
  const { state } = useStore();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => searchSongs(state.catalog, query, 60), [state.catalog, query]);
  const typed = query.trim().length > 0;

  return (
    <div className="search">
      <header className="search-head">
        <button className="topbar-btn" onClick={onBack} aria-label={tt("Back to home")}>
          <IconBack />
        </button>
        <input
          ref={input}
          className="auth-input search-input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder={tt("Songs, artists or albums")}
          aria-label={tt("Search songs")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onBack();
            if (e.key === "Enter" && results[0]) onPlay(results[0]);
          }}
        />
      </header>

      {!typed && (
        <p className="search-hint">
          {tt("Search all {n} songs in the deck. Tap one to play it from its hook.", { n: state.catalog.length.toLocaleString() })}
        </p>
      )}
      {typed && results.length === 0 && (
        <p className="search-hint">{tt("Nothing in the deck matches “{q}” yet.", { q: query.trim() })}</p>
      )}

      {results.length > 0 && (
        <ul className="search-results" aria-label={tt("Results")}>
          {results.map((t) => (
            <li key={t.id}>
              <button className="search-row" onClick={() => onPlay(t)} aria-label={`${t.title} — ${t.artist}. ${tt("Play it")}.`}>
                <img className="search-art" src={art(t.artwork, 120)} alt="" loading="lazy" />
                <span className="search-text">
                  <span className="search-title">{t.title}</span>
                  <span className="search-artist">{t.artist}</span>
                </span>
                <span className="search-genre">{t.genre}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
