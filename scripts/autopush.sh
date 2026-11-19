#!/usr/bin/env bash
# Commit + push any work-in-progress every INTERVAL seconds so a lost sandbox
# never loses more than one interval of work. Silent when there is nothing to do.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
INTERVAL="${AUTOPUSH_INTERVAL:-600}"
BRANCH="${AUTOPUSH_BRANCH:-main}"
LOG="${AUTOPUSH_LOG:-/tmp/autopush.log}"

log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

log "autopush mulai (interval ${INTERVAL}s, branch ${BRANCH})"
while true; do
  sleep "$INTERVAL"
  if [ -z "$(git status --porcelain)" ]; then
    log "tidak ada perubahan"
    continue
  fi
  git add -A
  git -c user.name=openhands -c user.email=openhands@all-hands.dev \
    commit -q -m "wip otomatis $(date -Is)

Co-authored-by: openhands <openhands@all-hands.dev>" >>"$LOG" 2>&1
  if git push -q origin "$BRANCH" >>"$LOG" 2>&1; then
    log "push ok $(git rev-parse --short HEAD)"
  else
    log "push GAGAL, akan coba lagi pada siklus berikutnya"
  fi
done
