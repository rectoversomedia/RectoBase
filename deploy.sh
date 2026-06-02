#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  RectoBase – Deploy to VPS
#
#  Usage:
#    ./deploy.sh user@IP [subdomain.domain.com]
#
#  Examples:
#    ./deploy.sh root@123.456.789.0 base.rectoversomedia.com
#    ./deploy.sh root@123.456.789.0          ← skip health-check
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VPS="${1:?Usage: $0 user@IP [domain.com]}"
DOMAIN="${2:-}"
REMOTE_DIR="/var/www/rectobase"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
SSH_OPTS="-o StrictHostKeyChecking=accept-new"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

echo -e "\n${GREEN}🚀  Deploying RectoBase${RESET}"
echo "    From  : $LOCAL_DIR"
echo "    To    : $VPS:$REMOTE_DIR"
[[ -n "$DOMAIN" ]] && echo "    Domain: https://$DOMAIN"
echo ""

# Sync files (rsync over SSH)
rsync -avz --progress \
  -e "ssh $SSH_OPTS" \
  --checksum \
  --delete \
  --exclude='.DS_Store' \
  --exclude='*.sh' \
  --exclude='*.md' \
  --exclude='api/tripay-callbacks.log' \
  --exclude='api/data/auth-store.json' \
  --exclude='.git/' \
  --exclude='.env*' \
  --exclude='node_modules/' \
  "$LOCAL_DIR/" "$VPS:$REMOTE_DIR/"

echo -e "\n${GREEN}✅  Files synced.${RESET}"

# Set correct permissions on VPS
echo "    Setting permissions..."
ssh $SSH_OPTS "$VPS" "
  chown -R www-data:www-data $REMOTE_DIR
  chmod -R 755 $REMOTE_DIR
  find $REMOTE_DIR/api -name '*.php' -exec chmod 644 {} +
  echo '    Permissions OK.'
"

# Optional health check
if [[ -n "$DOMAIN" ]]; then
  echo ""
  echo "    Health check: https://$DOMAIN"
  sleep 1
  HTTP="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$DOMAIN/" || echo 000)"
  PHP="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$DOMAIN/api/tripay.php?action=test" || echo 000)"
  echo "    Site HTTP   : $HTTP $([ "$HTTP" = "200" ] && echo "✓" || echo "← cek nginx")"
  echo "    PHP endpoint: $PHP $([ "$PHP" = "200" ] && echo "✓" || echo "← cek PHP-FPM")"
fi

echo -e "\n${GREEN}══════════════════════════════════════════════════${RESET}"
echo   "  Deploy selesai."
if [[ -n "$DOMAIN" ]]; then
  echo   "  → https://$DOMAIN"
  echo   ""
  echo   "  Tripay callback URL (daftarkan di dashboard Tripay jika belum):"
  echo   "  → https://$DOMAIN/api/tripay.php?action=callback"
fi
echo -e "${GREEN}══════════════════════════════════════════════════${RESET}\n"
