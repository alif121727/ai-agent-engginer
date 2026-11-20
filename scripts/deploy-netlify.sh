#!/usr/bin/env bash
# Deploy netlify-site/ ke situs Netlify yang sudah ada (agent-studio-ai).
#
# Kenapa CLI, bukan build dari Git: build dari Git bisa di-skip Netlify saat
# kuota build menit habis (deploy state=error, skipped=true, build_time null).
# `netlify deploy --dir` mengunggah berkas yang sudah dibangun, jadi tidak
# memakai build menit dan tetap mempertahankan URL situs yang sama.
#
# Pakai: ./scripts/deploy-netlify.sh [--dry]
set -uo pipefail

SITE_ID="7c88850b-1563-4372-a2b9-f4aa1240c20d"
SITE_URL="https://agent-studio-ai.netlify.app"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${NETLIFY_CLI:-$ROOT/../tools/node_modules/.bin/netlify}"

[ -x "$CLI" ] || { echo "netlify-cli tidak ada di $CLI (set NETLIFY_CLI)"; exit 1; }

HASH=$(grep -o 'studio.js?v=[a-f0-9]*' "$ROOT/netlify-site/index.html" | head -1 | cut -d= -f2)
[ -n "$HASH" ] || { echo "index.html tidak menyebut hash bundel; jalankan npm run build:studio"; exit 1; }
echo "Bundel lokal: v=$HASH"

"$CLI" status --json >/dev/null 2>&1 || { echo "Belum login. Jalankan: $CLI login"; exit 1; }

# `link --id` menolak folder yang sudah tertaut ke situs lain, jadi bersihkan dulu.
cd "$ROOT" || exit 1
"$CLI" unlink >/dev/null 2>&1
rm -rf "$ROOT/.netlify"
"$CLI" link --id "$SITE_ID" >/dev/null || { echo "Gagal menautkan situs $SITE_ID"; exit 1; }

if [ "${1:-}" = "--dry" ]; then
  "$CLI" deploy --no-build --dir netlify-site --message "dry run v=$HASH"
  exit $?
fi

"$CLI" deploy --no-build --prod --dir netlify-site --message "Studio AI v=$HASH" || exit 1

# Netlify meng-cache index.html sebentar; bandingkan hash untuk bukti versi live.
for _ in $(seq 1 20); do
  LIVE=$(curl -s "$SITE_URL/" | grep -o 'studio.js?v=[a-f0-9]*' | head -1 | cut -d= -f2)
  [ "$LIVE" = "$HASH" ] && { echo "Live cocok: $SITE_URL (v=$HASH)"; exit 0; }
  sleep 5
done
echo "Deploy terkirim, tapi situs masih menyajikan v=$LIVE (harapan v=$HASH)."
echo "Cek https://app.netlify.com/projects/agent-studio-ai/deploys"
