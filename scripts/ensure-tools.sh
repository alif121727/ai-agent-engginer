#!/usr/bin/env bash
# Pastikan `ffmpeg` DAN `ffprobe` ada di PATH.
#
# Kenapa ada: image sandbox kadang hanya punya salah satunya, atau tidak sama
# sekali. Tanpa ffprobe, empat test audio gagal dengan pesan "berkas mesin
# tidak terbaca sebagai audio" — kegagalan lingkungan yang menyamar sebagai bug
# kode dan menghabiskan waktu debugging.
#
# Pemakaian: `source scripts/ensure-tools.sh` (meng-export PATH) atau jalankan
# langsung untuk sekadar memeriksa.
set -uo pipefail

have_both() { command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; }

if have_both; then
  echo "[tools] ffmpeg + ffprobe sudah tersedia: $(command -v ffmpeg)"
  return 0 2>/dev/null || exit 0
fi

bin="$HOME/.local/bin"
mkdir -p "$bin"

# static-ffmpeg menyediakan ffmpeg dan ffprobe berdampingan.
if python3 -c "import static_ffmpeg" >/dev/null 2>&1; then
  pair=$(python3 -c "
from static_ffmpeg import run
print('\n'.join(run.get_or_fetch_platform_executables_else_raise()))
" 2>/dev/null)
  src_ffmpeg=$(printf '%s\n' "$pair" | sed -n 1p)
  src_ffprobe=$(printf '%s\n' "$pair" | sed -n 2p)
  [ -x "$src_ffmpeg" ] && ln -sf "$src_ffmpeg" "$bin/ffmpeg"
  [ -x "$src_ffprobe" ] && ln -sf "$src_ffprobe" "$bin/ffprobe"
fi

# Cadangan: imageio-ffmpeg hanya membawa ffmpeg, jadi ffprobe tetap bisa
# dipanggil lewat antarmuka `-i`-nya (dipakai `src/render/ffmpeg.ts`).
if ! command -v ffmpeg >/dev/null 2>&1 && python3 -c "import imageio_ffmpeg" >/dev/null 2>&1; then
  ln -sf "$(python3 -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')" "$bin/ffmpeg"
fi

export PATH="$bin:$PATH"

if have_both; then
  echo "[tools] siap: $(command -v ffmpeg) | $(command -v ffprobe)"
else
  echo "[tools] PERINGATAN: ffmpeg/ffprobe belum lengkap. Jalankan:" >&2
  echo "        pip install -r requirements-dev.txt" >&2
  exit 1
fi
