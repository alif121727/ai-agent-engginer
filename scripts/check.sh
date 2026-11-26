#!/usr/bin/env bash
# Gerbang kualitas satu perintah: jalankan SEBELUM commit/push.
#
# Semua langkah di sini pernah gagal diam-diam di produksi, jadi semuanya
# dijadikan pemeriksaan wajib. Berhenti pada kegagalan pertama agar pesan
# errornya tidak tenggelam.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
fail=0

step() {
  local name="$1"; shift
  printf '\n=== %s ===\n' "$name"
  if "$@"; then
    printf '  OK  %s\n' "$name"
  else
    printf '  GAGAL  %s\n' "$name"
    fail=1
  fi
}

# ffmpeg/ffprobe dulu: tanpanya banyak langkah lain gagal dengan pesan menyesatkan.
source scripts/ensure-tools.sh >/dev/null 2>&1 || bash scripts/ensure-tools.sh

step "Tipe TypeScript studio" npm run --silent typecheck:studio
# Build dulu: menyalin sw.js/manifest.json ke public/, yang diperiksa npm test.
step "Build studio" npm run --silent build:studio
step "Test Node (npm test)" npm run --silent test
step "Test Python (cartpl)" bash -c 'python3 -m pytest tests/ -q'

printf '\n'
if [ "$fail" -eq 0 ]; then
  echo "SEMUA GERBANG LULUS — aman untuk commit."
else
  echo "ADA GERBANG GAGAL — jangan commit dulu." >&2
fi
exit "$fail"
