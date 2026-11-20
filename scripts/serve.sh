#!/usr/bin/env bash
# Jalankan API + UI di port publik sandbox, lalu worker terpisah.
# Pemakaian: ./scripts/serve.sh [port]   (default 12000)
set -u
PORT="${1:-12000}"
cd "$(dirname "$0")/.."
export PORT
export APP_URL="${APP_URL:-https://work-1-lxpwikokempxmoli.prod-runtime.all-hands.dev}"

if ! curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
  nohup node --experimental-strip-types src/api/main.ts > /tmp/api.log 2>&1 &
  echo "api  -> port ${PORT} (log /tmp/api.log)"
fi

if ! pgrep -f "src/worker/main.ts" >/dev/null; then
  nohup node --experimental-strip-types src/worker/main.ts > /tmp/worker.log 2>&1 &
  echo "worker -> mulai (log /tmp/worker.log)"
fi

sleep 2
curl -s "http://localhost:${PORT}/api/health" || echo "health gagal, cek /tmp/api.log"
echo
echo "Buka: ${APP_URL}"
