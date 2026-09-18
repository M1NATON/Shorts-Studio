"use client";
import { useEffect, useState } from "react";
import type { PlayerRef } from "@remotion/player";

/** Текущий кадр плеера. Подписка своя у каждого потребителя — страница не перерисовывается 30 раз в секунду. */
export function usePlayerFrame(player: PlayerRef | null): number {
  const [frame, setFrame] = useState(() => player?.getCurrentFrame() ?? 0);
  useEffect(() => {
    if (!player) return;
    setFrame(player.getCurrentFrame());
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("seeked", onFrame);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("seeked", onFrame);
    };
  }, [player]);
  return frame;
}

export function usePlaying(player: PlayerRef | null): boolean {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!player) return;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    player.addEventListener("play", on);
    player.addEventListener("pause", off);
    player.addEventListener("ended", off);
    return () => {
      player.removeEventListener("play", on);
      player.removeEventListener("pause", off);
      player.removeEventListener("ended", off);
    };
  }, [player]);
  return playing;
}

/** «0:16.4» — таймкод с десятыми. */
export function timecode(frame: number, fps: number, tenths = true): string {
  const sec = Math.max(0, frame / fps);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return tenths ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
}
