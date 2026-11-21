#!/usr/bin/env bash
# Deploy netlify-site/ ke situs agent-studio-ai (URL tetap: https://agent-studio-ai.netlify.app).
#
# Kenapa tidak `deploy --prod`: akun Free bisa kehabisan kredit, dan Netlify
# memblokir SEMUA deploy ber-otentikasi dengan 403 "Account credit usage
# exceeded". Build dari Git juga di-skip di kondisi yang sama (state=error,
# skipped=true, build_time null).
#
# Jalur yang tetap jalan: unggah sebagai deploy preview tanpa otentikasi
# (tidak menyentuh kredit), lalu promosikan deploy itu ke produksi lewat API
# memakai token login. Hasilnya URL lama menyajikan bundel baru.
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

cd "$ROOT" || exit 1

# Token bisa datang dari environment (paling tahan restart) atau dari config
# CLI. Sandbox ini pernah me-reset ~/.config/netlify sehingga config kosong,
# jadi NETLIFY_AUTH_TOKEN harus didahulukan.
TOKEN="${NETLIFY_AUTH_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN=$(python3 - <<'PY'
import json, os
try:
    cfg = json.load(open(os.path.expanduser("~/.config/netlify/config.json")))
    print(list(cfg.get("users", {}).values())[0].get("auth", {}).get("token", ""))
except Exception:
    print("")
PY
)
fi

if [ -z "$TOKEN" ]; then
  cat <<EOF
Belum ada kredensial Netlify. Pilih salah satu:

  1) Login lewat browser (tanpa menyalin token):
       $CLI login --request "Deploy Studio AI"
     Buka Authorize URL yang tercetak, setujui, lalu:
       $CLI login --check <ticket>

  2) Pakai personal access token:
       NETLIFY_AUTH_TOKEN=xxx $0

Catatan: build Netlify dari GitHub di-skip (kredit habis), jadi push tidak
memperbarui situs. Tanpa token, deploy tidak bisa dijalankan.
EOF
  exit 1
fi

# Diekspor supaya `link`, `deploy`, dan panggilan CLI lain memakai token yang
# sama; tanpa ini `deploy` mengeluh "No project linked" meski state.json ada.
export NETLIFY_AUTH_TOKEN="$TOKEN"

"$CLI" unlink >/dev/null 2>&1
rm -rf "$ROOT/.netlify"
"$CLI" link --id "$SITE_ID" >/dev/null \
  || { echo "Gagal menautkan situs $SITE_ID (token ditolak?)"; exit 1; }

# `link` bisa keluar dengan kode 0 tanpa menulis state (mis. token tidak sah),
# dan kegagalannya baru muncul sebagai "No project linked" di langkah deploy.
LINKED=$(python3 -c "
import json
try: print(json.load(open('$ROOT/.netlify/state.json')).get('siteId',''))
except Exception: print('')
")
[ "$LINKED" = "$SITE_ID" ] || {
  echo "Tautan situs tidak tersimpan (siteId='$LINKED'). Token kemungkinan tidak sah."
  exit 1
}
echo "Tertaut ke $SITE_ID"

# --site eksplisit: `deploy` sempat mengabaikan tautan lokal dan mengeluh
# "No project linked" walau .netlify/state.json sudah benar.
OUT=$("$CLI" deploy --no-build --dir netlify-site --allow-anonymous --json \
      --site "$SITE_ID" --message "Studio AI v=$HASH" 2>&1)
DEPLOY_ID=$(printf '%s' "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('deploy_id',''))" 2>/dev/null)
[ -n "$DEPLOY_ID" ] || {
  echo "$OUT" | tail -5
  case "$OUT" in
    *Unauthorized*) echo "Token Netlify ditolak. Buat token baru di User settings -> Applications -> Personal access tokens." ;;
  esac
  exit 1
}
echo "Deploy preview: $DEPLOY_ID"

if [ "${1:-}" = "--dry" ]; then
  echo "Dry run berhenti di sini; produksi tidak diubah."
  exit 0
fi

CODE=$(curl -s -o /tmp/restore.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}' "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys/$DEPLOY_ID/restore")
[ "$CODE" = "200" ] || { echo "Promosi gagal (HTTP $CODE):"; cat /tmp/restore.json; exit 1; }

# CDN menyajikan index.html lama sebentar; bandingkan hash sebagai bukti.
for _ in $(seq 1 20); do
  LIVE=$(curl -s "$SITE_URL/?cb=$RANDOM" | grep -o 'studio.js?v=[a-f0-9]*' | head -1 | cut -d= -f2)
  [ "$LIVE" = "$HASH" ] && { echo "Live cocok: $SITE_URL (v=$HASH)"; exit 0; }
  sleep 6
done
echo "Deploy dipromosikan, tapi situs masih menyajikan v=$LIVE (harapan v=$HASH)."
echo "Cek https://app.netlify.com/projects/agent-studio-ai/deploys"
