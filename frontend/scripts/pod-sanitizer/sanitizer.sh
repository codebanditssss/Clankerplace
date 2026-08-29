#!/bin/bash
# Launches the pods.ml content-sanitizer proxy as a background daemon
# inside the Hermes pod. Idempotent — kills any prior instance first.
#
# Reads /home/container/.pods/sanitizer.env for PODS_SANITIZER_UPSTREAM.
# Logs to /home/container/.pods/sanitizer.log.
#
# Designed to be called by:
#   - the egg's install/startup hook on new deploys
#   - the provider-switch route after rewriting model.base_url
#   - manually for debugging

set -e

PODS_DIR=/home/container/.pods
SCRIPT="$PODS_DIR/sanitizer.py"
ENVF="$PODS_DIR/sanitizer.env"
PIDF="$PODS_DIR/sanitizer.pid"
LOGF="$PODS_DIR/sanitizer.log"
PY=/home/container/hermes-agent/venv/bin/python3

mkdir -p "$PODS_DIR"

if [ ! -f "$SCRIPT" ]; then
  echo "sanitizer.py missing at $SCRIPT" >&2
  exit 1
fi
if [ ! -f "$ENVF" ]; then
  echo "sanitizer.env missing at $ENVF (need PODS_SANITIZER_UPSTREAM)" >&2
  exit 1
fi

# Kill anything bound to the same port (idempotent re-launch).
if [ -f "$PIDF" ]; then
  oldpid=$(cat "$PIDF" 2>/dev/null || true)
  if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
    kill -TERM "$oldpid" 2>/dev/null || true
    sleep 1
    kill -KILL "$oldpid" 2>/dev/null || true
  fi
fi
# Belt-and-suspenders — anything else holding 8765 also dies.
pkill -f "$SCRIPT" 2>/dev/null || true
sleep 0.5

# Spawn in the background, detached from the calling shell.
set -a
. "$ENVF"
set +a
nohup "$PY" "$SCRIPT" >>"$LOGF" 2>&1 &
echo $! >"$PIDF"
disown 2>/dev/null || true

# Wait briefly for the listener to come up + sanity-check.
sleep 1
for i in 1 2 3 4 5; do
  if curl -sf "http://127.0.0.1:${PODS_SANITIZER_PORT:-8765}/healthz" >/dev/null; then
    echo "sanitizer up on :${PODS_SANITIZER_PORT:-8765} → $PODS_SANITIZER_UPSTREAM (pid $(cat $PIDF))"
    exit 0
  fi
  sleep 1
done
echo "sanitizer FAILED to come up — see $LOGF" >&2
tail -20 "$LOGF" >&2
exit 1
