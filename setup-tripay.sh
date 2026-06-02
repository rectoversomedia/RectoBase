#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  RectoBase – Update Tripay credentials on running server
#  Run on VPS as root. Does NOT re-run full setup.
#
#  Usage:
#    bash setup-tripay.sh \
#      --api-key      T-xxx \
#      --private-key  xxx   \
#      --merchant-code T5xxx \
#      [--mode sandbox|production]
#
#  Or interactively (no args):
#    bash setup-tripay.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SECRETS_FILE="/etc/rectobase/tripay.conf"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
fatal() { echo -e "${RED}✗  $*${RESET}"; exit 1; }

[[ $EUID -eq 0 ]] || fatal "Run as root: sudo bash $0 $*"

# ── Credentials (sudah terisi, override via args jika perlu) ──────────────────
API_KEY="YCLYXMbyJHAZxKrVNacBplaZGAvfHatSGZDG0tla"
PRIVATE_KEY="EZ0yL-IvhEb-nAhCw-bJYAe-3zRU5"
MERCHANT_CODE="T50630"
MODE="production"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-key)       API_KEY="$2";       shift 2 ;;
    --private-key)   PRIVATE_KEY="$2";   shift 2 ;;
    --merchant-code) MERCHANT_CODE="$2"; shift 2 ;;
    --mode)          MODE="$2";          shift 2 ;;
    --sandbox)       MODE="sandbox";     shift   ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Write secrets file
mkdir -p "$(dirname "$SECRETS_FILE")"
cat > "$SECRETS_FILE" <<EOF
# RectoBase – Tripay fastcgi params
# Updated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
fastcgi_param TRIPAY_API_KEY       "$API_KEY";
fastcgi_param TRIPAY_PRIVATE_KEY   "$PRIVATE_KEY";
fastcgi_param TRIPAY_MERCHANT_CODE "$MERCHANT_CODE";
fastcgi_param TRIPAY_MODE          "$MODE";
EOF
chmod 600 "$SECRETS_FILE"

# Test nginx config before reloading
nginx -t || fatal "Nginx config test gagal. Cek: sudo nginx -t"
systemctl reload nginx

echo -e "\n${GREEN}✅  Tripay credentials diperbarui (mode: $MODE)${RESET}"
echo "    File: $SECRETS_FILE"
echo ""
echo "  Verifikasi:"
echo "    curl https://\$(hostname -f)/api/tripay.php?action=test"
echo ""
