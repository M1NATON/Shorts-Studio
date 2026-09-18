"use client";
import { useEffect, useState } from "react";
import { api, type MusicTrack, type ProjectMusic } from "@/lib/api";

const MOOD_LABEL: Record<string, string> = {
  calm: "спокойная",
  upbeat: "бодрая",
  tech: "техно",
  dramatic: "драматичная",
  playful: "игривая",
  serious: "серьёзная",
};

export const trackLabel = (file: string) => file.replace(/\.[a-z0-9]+$/i, "").replace(/-/g, " ");

/** Фоновая музыка ролика: трек из storage/music (с прослушиванием) и громкость под голосом. */
export function MusicPicker({ value, onChange }: { value: ProjectMusic | null; onChange: (music: ProjectMusic | null) => void }) {
  const [tracks, setTracks] = useState<MusicTrack[]>();
  const [volume, setVolume] = useState(value?.volume ?? 0.12);
  useEffect(() => {
    api.music().then(setTracks).catch(() => setTracks([]));
  }, []);

  if (tracks && tracks.length === 0) {
    return <p className="small muted">Треков нет. Положите mp3 в storage/music: префикс имени задаёт настроение (calm-…, tech-…).</p>;
  }
  const commitVolume = () => value && volume !== value.volume && onChange({ ...value, volume });

  return (
    <div className="stack">
      <label className="stack small">
        Трек
        <select
          className="select"
          value={value?.track ?? ""}
          onChange={(e) => onChange(e.target.value ? { track: e.target.value, volume } : null)}
        >
          <option value="">Без музыки</option>
          {(tracks ?? []).map((t) => (
            <option key={t.file} value={t.file}>{trackLabel(t.file)}{t.mood ? ` · ${MOOD_LABEL[t.mood]}` : ""}</option>
          ))}
        </select>
      </label>
      {value ? (
        <>
          <audio controls preload="none" src={`/music/${encodeURIComponent(value.track)}`} style={{ width: "100%" }} />
          <label className="stack small">
            Громкость под голосом: <span className="mono">{Math.round(volume * 100)}%</span>
            <input type="range" min={0} max={0.4} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} onPointerUp={commitVolume} onKeyUp={commitVolume} />
          </label>
        </>
      ) : null}
      <p className="small muted">Музыка меняет MP4 — после смены ролик нужно экспортировать заново.</p>
    </div>
  );
}
