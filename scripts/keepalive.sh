#!/usr/bin/env bash
# Penjaga API + worker: cek tiap INTERVAL detik, hidupkan lagi kalau mati.
#
# Kenapa ada: sandbox mematikan proses latar tanpa peringatan, sehingga URL
# publik menjawab 502 dan pengguna mengira situsnya mati. Skrip ini tidak
# mengubah kode, hanya memastikan prosesnya hidup kembali.
#
# Pakai: nohup ./scripts/keepalive.sh > /tmp/keepalive.log 2>&1 &
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-12000}"
INTERVAL="${KEEPALIVE_INTERVAL:-30}"
LOG="${KEEPALIVE_LOG:-/tmp/keepalive.log}"

log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

cd "$ROOT" || exit 1
log "penjaga mulai (port $PORT, interval ${INTERVAL}s)"

while true; do
  if ! curl -sf -m 5 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    if ! pgrep -f "src/api/main.ts" >/dev/null; then
      nohup node --experimental-strip-types src/api/main.ts >>/tmp/api.log 2>&1 &
      log "API mati -> dihidupkan (pid $!)"
    else
      # Proses ada tapi health gagal: beri waktu, jangan langsung bunuh.
      log "health gagal tapi proses API ada; menunggu"
    fi
  fi

  if ! pgrep -f "src/worker/main.ts" >/dev/null; then
    nohup node --experimental-strip-types src/worker/main.ts >>/tmp/worker.log 2>&1 &
    log "worker mati -> dihidupkan (pid $!)"
  fi

  sleep "$INTERVAL"
done
