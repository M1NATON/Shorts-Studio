#!/usr/bin/env bash
# Генерирует короткий тихий whoosh для смены сцен (см. ShortsVideo.tsx).
# Никаких сторонних файлов — белый шум, полосовой фильтр и огибающая (fade in/out).
#
# Использование:
#   scripts/generate-sfx.sh <путь-до-storage>/sfx/whoosh.mp3
#
# Пересоздать/подправить звук — просто перезапустить с новыми параметрами ниже.
set -euo pipefail

out="${1:?usage: generate-sfx.sh <output.mp3>}"
mkdir -p "$(dirname "$out")"

ffmpeg -y -f lavfi -i "anoisesrc=color=white:duration=0.35:sample_rate=44100:amplitude=1" \
  -af "highpass=f=600,lowpass=f=6000,afade=t=in:st=0:d=0.05,afade=t=out:st=0.22:d=0.13,volume=0.9" \
  -ac 1 -ar 44100 -b:a 96k "$out"
