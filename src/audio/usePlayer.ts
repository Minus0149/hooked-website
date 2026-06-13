import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "../types";

/**
 * Single-element audio engine with next-track preloading.
 * Browsers only allow playback after a user gesture; the onboarding /
 * "start discovering" tap satisfies that before this hook ever plays.
 */
export function usePlayer(
  track: Track | null,
  nextTrack: Track | null,
  enabled: boolean,
  onEnded: () => void,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 of the preview clip
  const [remaining, setRemaining] = useState(Infinity); // seconds left in the clip
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
    audio.src = track.previewUrl;
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
    pre.src = nextTrack.previewUrl;
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
      if (audio.duration > 0) {
        setProgress(audio.currentTime / audio.duration);
        setRemaining(audio.duration - audio.currentTime);
      }
    };
    const onDone = () => onEndedRef.current();
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onDone);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onDone);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }, []);

  /** Jump to a fraction (0..1) of the preview — powers the scrub bar. */
  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !(audio.duration > 0)) return;
    const clamped = Math.min(Math.max(fraction, 0), 0.999);
    audio.currentTime = clamped * audio.duration;
    setProgress(clamped);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(Math.max(v, 0), 1);
    if (audioRef.current) audioRef.current.volume = clamped;
    setVolumeState(clamped);
    localStorage.setItem("hooked.volume", String(clamped));
  }, []);

  return { playing, progress, remaining, volume, toggle, seek, setVolume };
}
