#!/usr/bin/env bash
# Deploy backend studio ke Fly.io dalam satu perintah.
#
#   FLY_API_TOKEN=... ./scripts/deploy-fly.sh [nama-app]
#
# Idempoten: app, volume, dan secret yang sudah ada tidak dibuat ulang.
# Image diambil dari GHCR (sudah dibangun workflow `Image backend`), jadi tidak
# ada build di sisi Fly yang bisa menggantung.
set -uo pipefail

APP="${1:-${FLY_APP:-studio-ai-otomotif}}"
REGION="${FLY_REGION:-sin}"
VOLUME="${FLY_VOLUME:-studio_data}"
IMAGE="${FLY_IMAGE:-ghcr.io/alif121727/ai-agent-engginer:latest}"
SITE="${STUDIO_SITE:-https://alif121727.github.io}"

FLY="$(command -v flyctl || command -v fly || true)"
if [ -z "$FLY" ]; then
  echo "flyctl tidak ditemukan. Pasang dulu: https://fly.io/docs/flyctl/install/" >&2
  exit 1
fi
if [ -z "${FLY_API_TOKEN:-}" ]; then
  echo "FLY_API_TOKEN belum diisi. Buat di https://fly.io/user/personal_access_tokens" >&2
  exit 1
fi

say() { printf '\n== %s\n' "$*"; }

say "app: $APP (region $REGION)"
if ! "$FLY" apps list 2>/dev/null | awk '{print $1}' | grep -qx "$APP"; then
  "$FLY" apps create "$APP" || { echo "gagal membuat app (nama mungkin sudah dipakai)" >&2; exit 1; }
else
  echo "app sudah ada, dilewati"
fi

say "volume $VOLUME"
if ! "$FLY" volumes list -a "$APP" 2>/dev/null | awk '{print $1}' | grep -qx "$VOLUME"; then
  "$FLY" volumes create "$VOLUME" --size 10 --region "$REGION" -a "$APP" --yes || exit 1
else
  echo "volume sudah ada, dilewati"
fi

say "secret"
SECRETS="$("$FLY" secrets list -a "$APP" 2>/dev/null | awk '{print $1}')"
if ! printf '%s\n' "$SECRETS" | grep -qx SESSION_SECRET; then
  "$FLY" secrets set SESSION_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" -a "$APP" --stage
fi
if ! printf '%s\n' "$SECRETS" | grep -qx APP_URL; then
  "$FLY" secrets set APP_URL="https://$APP.fly.dev" -a "$APP" --stage
fi
if ! printf '%s\n' "$SECRETS" | grep -qx CORS_ORIGINS; then
  "$FLY" secrets set "CORS_ORIGINS=$SITE,https://agent-studio-ai.netlify.app" -a "$APP" --stage
fi

say "deploy image $IMAGE"
"$FLY" deploy --image "$IMAGE" --ha=false -a "$APP" --yes || exit 1

say "menunggu health"
for i in $(seq 1 30); do
  sleep 10
  BODY="$(curl -fsS --max-time 10 "https://$APP.fly.dev/api/health" 2>/dev/null || true)"
  if printf '%s' "$BODY" | grep -q '"ok":true'; then
    echo "$BODY"
    say "selesai: https://$APP.fly.dev"
    echo "Buka https://$SITE/ai-agent-engginer/?backend=https://$APP.fly.dev sekali,"
    echo "lalu daftar akun admin pertama di https://$APP.fly.dev/"
    exit 0
  fi
  echo "  percobaan $i/30: ${BODY:-belum menjawab}"
done

echo "health tidak pernah hijau. Periksa: $FLY logs -a $APP" >&2
exit 1
