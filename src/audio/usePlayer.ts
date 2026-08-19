import { useCallback, useEffect, useRef, useState } from "react";
import type { HookWindow, Track } from "../types";

const FALLBACK_HOOK: HookWindow = { id: "whole", startMs: 0, durationMs: Number.POSITIVE_INFINITY };

/** A track always has at least one window, even if nobody marked one. */
export function hooksOf(track: Track | null): HookWindow[] {
  if (!track) return [FALLBACK_HOOK];
  return track.hooks && track.hooks.length > 0 ? track.hooks : [FALLBACK_HOOK];
}

const sourceOf = (track: Track) => track.audioUrl || track.previewUrl;

/**
 * Single-element audio engine with next-track preloading.
 *
 * A song can carry several hooks — 15-30s windows into the same audio. The
 * player walks them in order, auto-advancing at the end of each, and only calls
 * onEnded once the last one runs out. That way "skip" keeps meaning "skip the
 * song", not "skip this clip", and all four swipe gestures stay free.
 *
 * Browsers only allow playback after a user gesture; the onboarding /
 * "start discovering" tap satisfies that before this hook ever plays.
 */
export function usePlayer(
  track: Track | null,
  nextTrack: Track | null,
  enabled: boolean,
  onEnded: () => void,
  /** called with the source that failed, so a broken track can be reported */
  onAudioError?: (src: string) => void,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onErrorRef = useRef(onAudioError);
  onErrorRef.current = onAudioError;
  const trackRef = useRef<Track | null>(track);
  trackRef.current = track;

  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 through the current hook
  const [remaining, setRemaining] = useState(Infinity); // seconds left in the hook
  const [hookIndex, setHookIndex] = useState(0);

  const hooks = hooksOf(track);
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const hookIndexRef = useRef(0);
  hookIndexRef.current = hookIndex;
  const [volume, setVolumeState] = useState(() => {
    const raw = localStorage.getItem("hooked.volume");
    if (raw === null) return 1; // Number(null) is 0 — don't start muted
    const saved = Number(raw);
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 1;
  });

  if (audioRef.current === null && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
    audioRef.current.preload = "auto";
    audioRef.current.volume = volume;
  }

  // Load + autoplay whenever the on-deck track changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    setProgress(0);
    setRemaining(Infinity);
    setHookIndex(0);
    hookIndexRef.current = 0;
    audio.src = sourceOf(track);
    const first = hooksRef.current[0];
    if (first.startMs > 0) {
      // seeking before metadata lands is ignored, so wait for it
      const onReady = () => {
        audio.currentTime = first.startMs / 1000;
        audio.removeEventListener("loadedmetadata", onReady);
      };
      audio.addEventListener("loadedmetadata", onReady);
    }
    if (enabled) {
      audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false)); // autoplay blocked until a tap
    }
    return () => {
      audio.pause();
      setPlaying(false);
    };
  }, [track?.id, enabled]);

  // Warm the cache for the next card so swiping up feels instant
  useEffect(() => {
    if (!nextTrack) return;
    const pre = new Audio();
    pre.preload = "auto";
    pre.src = sourceOf(nextTrack);
    preloadRef.current = pre;
    return () => {
      pre.src = "";
      preloadRef.current = null;
    };
  }, [nextTrack?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      const list = hooksRef.current;
      const hook = list[hookIndexRef.current] ?? list[0];
      const startS = hook.startMs / 1000;
      const lenS = Number.isFinite(hook.durationMs)
        ? hook.durationMs / 1000
        : Math.max(audio.duration - startS, 0.001);
      const into = audio.currentTime - startS;

      setProgress(Math.min(Math.max(into / lenS, 0), 1));
      setRemaining(Math.max(lenS - into, 0));

      if (into >= lenS) advanceRef.current(true);
    };
    const onDone = () => advanceRef.current(true);
    /**
     * Dead audio must not park the deck.
     *
     * Preview URLs rotate and expire — with a curated hundred that never
     * happened, with a thousand off the charts it will. A card whose audio
     * 404s fires `error` and then nothing: no timeupdate, no ended, so the
     * auto-advance never runs and the deck simply stops with a silent card the
     * listener has to swipe by hand. Treat it as the song being over.
     */
    const onError = () => {
      setPlaying(false);
      onErrorRef.current?.(sourceOf(trackRef.current!) ?? "");
      onEndedRef.current();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onDone);
    audio.addEventListener("error", onError);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onDone);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  /**
   * Move to the next hook. auto=true means the window simply ran out, so when
   * there are none left the card is finished; a tap on the last hook wraps to
   * the first instead of skipping the song out from under someone.
   */
  const advanceRef = useRef<(auto: boolean) => void>(() => undefined);
  advanceRef.current = (auto: boolean) => {
    const audio = audioRef.current;
    const list = hooksRef.current;
    const next = hookIndexRef.current + 1;
    if (next >= list.length) {
      if (auto) {
        onEndedRef.current();
        return;
      }
      hookIndexRef.current = 0;
      setHookIndex(0);
    } else {
      hookIndexRef.current = next;
      setHookIndex(next);
    }
    const target = list[hookIndexRef.current];
    if (audio) {
      audio.currentTime = target.startMs / 1000;
      setProgress(0);
      if (audio.paused) void audio.play().catch(() => undefined);
    }
  };

  /** Tap the card to jump ahead to the next hook. */
  const nextHook = useCallback(() => advanceRef.current(false), []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }, []);

  /** Jump to a fraction (0..1) *of the current hook* — powers the scrub bar. */
  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !(audio.duration > 0)) return;
    const list = hooksRef.current;
    const hook = list[hookIndexRef.current] ?? list[0];
    const startS = hook.startMs / 1000;
    const lenS = Number.isFinite(hook.durationMs)
      ? hook.durationMs / 1000
      : Math.max(audio.duration - startS, 0.001);
    const clamped = Math.min(Math.max(fraction, 0), 0.999);
    audio.currentTime = startS + clamped * lenS;
    setProgress(clamped);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(Math.max(v, 0), 1);
    if (audioRef.current) audioRef.current.volume = clamped;
    setVolumeState(clamped);
    localStorage.setItem("hooked.volume", String(clamped));
  }, []);

  return {
    playing, progress, remaining, volume, toggle, seek, setVolume,
    hookIndex, hookCount: hooks.length, hook: hooks[hookIndex] ?? hooks[0], nextHook,
  };
}
