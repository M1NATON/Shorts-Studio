"use client";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { PlayerRef } from "@remotion/player";
import { timecode, usePlayerFrame, usePlaying } from "@/lib/player";

/** Свой транспорт под кадром: соседние сцены, пуск/пауза, таймкод. */
export function Transport({
  player,
  fps,
  total,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  player: PlayerRef | null;
  fps: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const frame = usePlayerFrame(player);
  const playing = usePlaying(player);
  return (
    <div className="transport" role="toolbar" aria-label="Воспроизведение">
      <button className="btn icon" disabled={!canPrev} onClick={onPrev} aria-label="Предыдущая сцена (←)" title="Предыдущая сцена (←)">
        <SkipBack size={16} strokeWidth={1.75} />
      </button>
      <button className="btn play" disabled={!player} onClick={() => player?.toggle()} aria-label={playing ? "Пауза (пробел)" : "Воспроизвести (пробел)"} title="Пробел">
        {playing ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
      </button>
      <button className="btn icon" disabled={!canNext} onClick={onNext} aria-label="Следующая сцена (→)" title="Следующая сцена (→)">
        <SkipForward size={16} strokeWidth={1.75} />
      </button>
      <span className="time mono" aria-label="Время">
        <b>{timecode(frame, fps)}</b> / {timecode(total, fps, false)}
      </span>
    </div>
  );
}
