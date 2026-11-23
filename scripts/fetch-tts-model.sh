#!/usr/bin/env bash
# Unduh model TTS lokal (Piper) untuk narasi Bahasa Indonesia.
#
# Model tidak masuk repo karena berukuran 63 MB. Jalankan sekali per mesin.
# Pemakaian: ./scripts/fetch-tts-model.sh [kode-bahasa]   (default: id)
set -eu

LANG_CODE="${1:-id}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/assets/tts"
VOICE="id_ID-news_tts-medium"
[ "$LANG_CODE" = "en" ] && VOICE="en_US-lessac-medium"

BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"
case "$VOICE" in
  id_ID-*) PREFIX="id/id_ID/news_tts/medium" ;;
  en_US-*) PREFIX="en/en_US/lessac/medium" ;;
  *) echo "voice tidak dikenal: $VOICE" >&2; exit 1 ;;
esac

mkdir -p "$DEST"
for ext in onnx onnx.json; do
  FILE="$VOICE.$ext"
  if [ -f "$DEST/$FILE" ]; then
    echo "sudah ada: $FILE"
    continue
  fi
  echo "unduh $FILE"
  curl -fsSL --retry 3 -o "$DEST/$FILE" "$BASE/$PREFIX/$FILE"
done

echo "selesai. Model di $DEST"
echo "Uji: echo 'Ini uji narasi.' | ${PIPER_BIN:-$HOME/.local/bin/piper} -m $DEST/$VOICE.onnx -f /tmp/uji.wav"
