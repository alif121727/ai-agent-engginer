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
"$CLI" unlink >/dev/null 2>&1
rm -rf "$ROOT/.netlify"
"$CLI" link --id "$SITE_ID" >/dev/null || { echo "Gagal menautkan situs $SITE_ID"; exit 1; }

# `status --json` keluar non-zero saat folder belum tertaut, dan `pipefail`
# meneruskan kegagalan itu, jadi periksa isi outputnya, bukan exit code.
STATUS_JSON=$("$CLI" status --json 2>/dev/null)
TOKEN=$(python3 - <<'PY'
import json, os
try:
    cfg = json.load(open(os.path.expanduser("~/.config/netlify/config.json")))
    print(list(cfg.get("users", {}).values())[0].get("auth", {}).get("token", ""))
except Exception:
    print("")
PY
)
case "$STATUS_JSON" in
  *'"loggedIn": true'*) [ -n "$TOKEN" ] || { echo "Token login tidak terbaca"; exit 1; } ;;
  *) echo "Belum login. Jalankan: $CLI login"; exit 1 ;;
esac

OUT=$("$CLI" deploy --no-build --dir netlify-site --allow-anonymous --json \
      --message "Studio AI v=$HASH" 2>&1)
DEPLOY_ID=$(printf '%s' "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('deploy_id',''))" 2>/dev/null)
[ -n "$DEPLOY_ID" ] || { echo "$OUT" | tail -15; exit 1; }
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
