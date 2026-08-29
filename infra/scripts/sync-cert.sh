#!/usr/bin/env bash
# Export the Caddy-managed Let's Encrypt cert to /etc/letsencrypt/live/<fqdn>/
# so Wings (which reads files, not Caddy storage) can use it. Idempotent;
# restarts Wings only when the cert content actually changes.
set -euo pipefail

FQDN="${1:?usage: sync-cert.sh <fqdn>}"
# Caddy 2 default storage on Debian/Ubuntu when run as service user `caddy`
SRC_BASE="/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$FQDN"
DST_DIR="/etc/letsencrypt/live/$FQDN"

if [[ ! -d "$SRC_BASE" ]]; then
  # Fallback: older Pelican-managed cert path (kept for backward compat during migration)
  if docker ps --format '{{.Names}}' | grep -q pelican-panel-1; then
    TMP_CRT=$(mktemp); TMP_KEY=$(mktemp); trap 'rm -f "$TMP_CRT" "$TMP_KEY"' EXIT
    PEL_BASE="/pelican-data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$FQDN"
    docker exec pelican-panel-1 cat "$PEL_BASE/$FQDN.crt" > "$TMP_CRT" 2>/dev/null || exit 0
    docker exec pelican-panel-1 cat "$PEL_BASE/$FQDN.key" > "$TMP_KEY" 2>/dev/null || exit 0
    mkdir -p "$DST_DIR"
    CHANGED=0
    cmp -s "$TMP_CRT" "$DST_DIR/fullchain.pem" 2>/dev/null || { cp "$TMP_CRT" "$DST_DIR/fullchain.pem"; CHANGED=1; }
    cmp -s "$TMP_KEY" "$DST_DIR/privkey.pem"   2>/dev/null || { cp "$TMP_KEY" "$DST_DIR/privkey.pem";   CHANGED=1; }
    chmod 600 "$DST_DIR/privkey.pem"; chmod 644 "$DST_DIR/fullchain.pem"
    [[ "$CHANGED" -eq 1 ]] && systemctl restart wings || true
    exit 0
  fi
  exit 0
fi

mkdir -p "$DST_DIR"
CHANGED=0
if ! cmp -s "$SRC_BASE/$FQDN.crt" "$DST_DIR/fullchain.pem" 2>/dev/null; then
  cp "$SRC_BASE/$FQDN.crt" "$DST_DIR/fullchain.pem"; CHANGED=1
fi
if ! cmp -s "$SRC_BASE/$FQDN.key" "$DST_DIR/privkey.pem" 2>/dev/null; then
  cp "$SRC_BASE/$FQDN.key" "$DST_DIR/privkey.pem"; CHANGED=1
fi
chmod 600 "$DST_DIR/privkey.pem"; chmod 644 "$DST_DIR/fullchain.pem"

if [[ "$CHANGED" -eq 1 ]]; then
  echo "cert updated, restarting wings"
  systemctl restart wings 2>/dev/null || true
fi
