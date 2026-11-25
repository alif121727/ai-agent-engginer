#!/usr/bin/env bash
# Menyalin hasil car-chase ke public/media/ supaya bisa ditonton lewat
# link sandbox. Video aslinya tetap di assets/car-chase/ (di-track git).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/assets/car-chase"
dst="$root/public/media"
mkdir -p "$dst"
for f in car-chase-60s.mp4 contact-sheet.png compare-old-vs-gt3rs.png; do
  [ -f "$src/$f" ] && cp "$src/$f" "$dst/$f"
done
echo "Pratinjau siap: /media/index.html"
