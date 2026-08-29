#!/usr/bin/env bash
# pods-ml-pod-init.sh — PID 1 of every FuelBorn sandbox container.
#
# Responsibilities:
#   1. Make sure the user's ~/.hermes/ + log dirs exist.
#   2. Supervise `hermes gateway run` so it survives panic-exits and is
#      auto-restarted whenever connector credentials are present in
#      ~/.hermes/.env. The user can restart it via the FuelBorn dashboard,
#      from inside the pod via `pod-gateway restart`, or by saving a
#      connector form (which sends pkill via docker exec).
#   3. Keep the container alive (PID 1 idles in `tail -f /dev/null`) so
#      `docker exec` sessions (the in-browser terminal) can attach and
#      detach freely without killing the pod.
#
# Per-pod-type override:
#   If /home/container/.start.sh exists, this script EXECs that script
#   instead — code-sandbox (code-server / claude-code / plain) and any
#   other non-Hermes pod type that needs custom startup uses this hook
#   without rebuilding the sandbox image.
set -u

# Pelican injects egg env_variables into the runtime container too, not
# just the install container. HERMES_INFERENCE_PROVIDER and
# HERMES_INFERENCE_MODEL are *install-time* hints we use to seed
# ~/.hermes/config.yaml. If they linger at runtime, Hermes' oneshot
# auto-detect (hermes_cli/oneshot.py:detect_provider_for_model) sees
# them, decides a Claude model name means provider=anthropic, and
# overrides whatever the user actually configured — breaking custom
# providers that route through a local sanitizer or any non-Anthropic
# endpoint. Drop them here so Hermes reads only from config.yaml.
unset HERMES_INFERENCE_PROVIDER HERMES_INFERENCE_MODEL

# Start the in-pod content-sanitizer proxy if installed. The /pods/
# scaffolding is written by the frontend's deploy + provider-switch
# routes for custom-provider pods using the OpenAI Chat Completions
# transport — it pads empty content blocks before they reach the
# upstream Claude relay (which would otherwise 400). No-op for pods
# that don't have it.
if [[ -x /home/container/.pods/sanitizer.sh ]]; then
  /home/container/.pods/sanitizer.sh >/dev/null 2>&1 || true
fi

# Pod-type override hook — runs before the Hermes supervisor.
# Three escape hatches in priority order:
#   1. /home/container/.start.sh — explicit per-type entrypoint
#      (code-sandbox, future pod types).
#   2. /home/container/.pods-pod-type — sentinel file with the pod type
#      slug (e.g. "code-sandbox"). Lets the volume declare what kind of
#      pod this is without owning a start script — useful for retroactive
#      type tagging.
#   3. If neither sentinel exists AND `hermes` binary isn't on PATH,
#      idle the container with tail -f /dev/null. Avoids the 5-second
#      restart loop you'd otherwise get from "hermes: command not found".
if [[ -x /home/container/.start.sh ]]; then
  exec /home/container/.start.sh
fi
# Detect the Hermes installation directly — `command -v hermes` against
# bare $PATH misses it because the install puts the binary at
# /home/container/.local/bin/hermes (not on PATH yet at this point of
# the script) and the venv copy at hermes-agent/venv/bin/hermes. Only
# idle if NEITHER known location holds an executable.
if [[ ! -x /home/container/.local/bin/hermes &&
      ! -x /home/container/hermes-agent/venv/bin/hermes ]]; then
  echo "[FuelBorn] no hermes binary + no .start.sh — idling. Drop a start script at /home/container/.start.sh or reinstall the egg."
  exec tail -f /dev/null
fi

LOG_DIR=${HOME:-/home/container}/.hermes/logs
mkdir -p "$LOG_DIR"
chown -R 998:998 "${HOME:-/home/container}/.hermes" 2>/dev/null || true

echo "[FuelBorn] $(date -u +%FT%TZ) pod-init starting" >>"$LOG_DIR/pod.log"

# ---- background: gateway supervisor ----
# Restart-loop guarded by a tiny env check so we don't spin if nothing's
# configured yet.  Save credentials via the FuelBorn Connectors tab to make
# the gateway start without manual intervention.
(
  cd "${HOME:-/home/container}"
  export HOME="${HOME:-/home/container}"
  export HERMES_HOME="$HOME/.hermes"
  export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

  # Try to keep the gateway alive unconditionally. Hermes refuses fast (<1s)
  # if no platforms are configured, so the restart cost is negligible. A
  # touch-file lets the user (or FuelBorn) explicitly pause the supervisor:
  #   touch ~/.hermes/.supervisor-disabled
  while true; do
    if [[ -e "$HERMES_HOME/.supervisor-disabled" ]]; then
      sleep 5
      continue
    fi
    echo "[FuelBorn] $(date -u +%FT%TZ) starting hermes gateway" >>"$LOG_DIR/gateway.log"
    # --replace clears any stale PID file from a crashed earlier instance.
    hermes gateway run --replace >>"$LOG_DIR/gateway.log" 2>&1
    rc=$?
    echo "[FuelBorn] $(date -u +%FT%TZ) gateway exited rc=$rc, restarting in 5s" >>"$LOG_DIR/gateway.log"
    sleep 5
  done
) </dev/null >>"$LOG_DIR/pod.log" 2>&1 &
SUPERVISOR_PID=$!
echo "[FuelBorn] supervisor pid=$SUPERVISOR_PID" >>"$LOG_DIR/pod.log"

# ---- foreground: hold the container alive ----
# tail -f /dev/null gives us a process that will sit forever, so the pod
# stays running even when no interactive shell is attached. Users connect
# via the FuelBorn console (which is `docker exec -it bash`), not stdin to
# this PID 1.
exec tail -f /dev/null
