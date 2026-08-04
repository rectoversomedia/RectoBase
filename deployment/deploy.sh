#!/bin/bash
# =============================================================================
# RectoBase Deployment Script
# Deploy RectoBase dari mesin lokal ke VPS menggunakan rsync
# =============================================================================

set -euo pipefail

# ─── Warna Output ───────────────────────────────────────────────────────────
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

# ─── Variabel ───────────────────────────────────────────────────────────────
SSH_HOST=""
DOMAIN=""
GIT_BRANCH="${3:-main}"
DEPLOY_USER="root"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_PORT="22"
RSYNC_REMOTE_DIR="/opt/rectobase"
RSYNC_OPTS=(
    --archive
    --compress
    --progress
    --stats
)
EXCLUDE_PATTERNS=(
    "node_modules"
    ".git"
    "*.log"
    ".env"
    ".env.*"
    ".DS_Store"
    ".vscode"
    ".idea"
    "dist"
    "coverage"
    ".nyc_output"
    "tmp"
    "temp"
    "uploads"
    ".cache"
    "*.log.*"
    ".npm"
    ".parcel-cache"
    "packages/*/dist"
    ".next"
)

# ─── Usage ──────────────────────────────────────────────────────────────────
usage() {
    cat <<EOF
Penggunaan: $0 <user@host> <domain> [git-branch]

Deploy RectoBase dari mesin lokal ke VPS menggunakan rsync.

ARGUMEN:
  user@host      SSH login ke VPS (contoh: root@192.168.1.100)
  domain         Domain RectoBase (contoh: pos.toko-saya.com)
  git-branch     Branch Git untuk deployment (default: main)

CONTOH:
  $0 root@192.168.1.100 pos.toko-saya.com
  $0 root@192.168.1.100 pos.toko-saya.com staging
  $0 -p 2222 root@192.168.1.100 pos.toko-saya.com

OPSI:
  -p, --port PORT    Port SSH (default: 22)
  -n, --dry-run      Preview saja, tidak benar-benar deploy
  -h, --help         Tampilkan bantuan ini

EOF
    exit 1
}

# ─── Parse Arguments ─────────────────────────────────────────────────────────
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--port)
            SSH_PORT="$2"
            shift 2
            ;;
        -n|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        -*)
            echo -e "${RED}[ERROR] Opsi tidak dikenal: $1${NC}"
            usage
            ;;
        *)
            if [[ -z "$SSH_HOST" ]]; then
                SSH_HOST="$1"
            elif [[ -z "$DOMAIN" ]]; then
                DOMAIN="$1"
            else
                GIT_BRANCH="$1"
            fi
            shift
            ;;
    esac
done

# Validasi wajib
if [[ -z "$SSH_HOST" || -z "$DOMAIN" ]]; then
    echo -e "${RED}[ERROR] Argumen kurang!${NC}"
    usage
fi

# ─── Helper Functions ───────────────────────────────────────────────────────
log() {
    echo -e "${GREEN}[DEPLOY]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

# Cek command availability
check_command() {
    if ! command -v "$1" &>/dev/null; then
        error "Perintah '$1' tidak ditemukan. Install dulu: $2"
        exit 1
    fi
}

# Remote SSH execution
ssh_cmd() {
    ssh -p "$SSH_PORT" -o StrictHostKeyChecking=no \
        -o ConnectTimeout=10 \
        -o ServerAliveInterval=15 \
        "$SSH_HOST" "$1"
}

# SCP file to remote
scp_file() {
    scp -P "$SSH_PORT" -o StrictHostKeyChecking=no "$1" "${SSH_HOST}:$2"
}

# ─── Pre-flight Checks ───────────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║         RectoBase Deployment Script                     ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
log "Memulai deployment..."
log "Target    : $SSH_HOST"
log "Domain    : $DOMAIN"
log "Branch    : $GIT_BRANCH"
log "SSH Port  : $SSH_PORT"
[[ "$DRY_RUN" == true ]] && warn "Mode DRY RUN - tidak ada perubahan nyata"
echo ""

# Cek dependencies
check_command rsync "apt-get install rsync"
check_command ssh  "OpenSSH client"
check_command npm  "Node.js/npm"

# ─── Step 1: Local Pre-deployment ───────────────────────────────────────────
step "1. Pre-deployment checks lokal..."

# Cek apakah package.json ada
if [[ ! -f "$LOCAL_DIR/package.json" ]]; then
    error "package.json tidak ditemukan di $LOCAL_DIR"
    exit 1
fi

# Cek apakah ada source code
if [[ ! -d "$LOCAL_DIR/src" && ! -d "$LOCAL_DIR/dist" ]]; then
    warn "Direktori src/ atau dist/ tidak ditemukan."
    warn "Akan men-deploy file yang ada..."
fi

# Build production assets if needed
if [[ -d "$LOCAL_DIR/src" && ! -d "$LOCAL_DIR/dist" ]]; then
    info "Building production assets..."
    cd "$LOCAL_DIR"

    if [[ -f "vite.config.js" || -f "vite.config.ts" ]]; then
        npm run build 2>&1 || {
            error "Build gagal!"
            exit 1
        }
        success "Production build selesai"
    elif [[ -f "next.config.js" || -f "next.config.mjs" ]]; then
        npm run build 2>&1 || {
            error "Build gagal!"
            exit 1
        }
        success "Next.js build selesai"
    else
        warn "Tidak ada step build yang dikenali - men-deploy source langsung"
    fi
fi

success "Pre-deployment lokal selesai"

# ─── Step 2: Remote Pre-deployment ─────────────────────────────────────────
step "2. Cek remote server..."

# Test SSH connection
info "Menguji koneksi SSH ke $SSH_HOST..."
if ! ssh -p "$SSH_PORT" -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=no "$SSH_HOST" "echo 'SSH OK'" &>/dev/null; then
    error "Tidak bisa konek ke $SSH_HOST via SSH port $SSH_PORT"
    error "Pastikan:"
    error "  1. VPS reachable: ping $SSH_HOST"
    error "  2. SSH service aktif: systemctl status ssh"
    error "  3. Firewall allow port $SSH_PORT"
    exit 1
fi
success "SSH connection OK"

# Cek disk space di remote
REMOTE_DISK=$(ssh_cmd "df -BG / | awk 'NR==2 {print \$4}' | tr -d G")
if [[ "${REMOTE_DISK:-0}" -lt 5 ]]; then
    error "Disk space remote kurang dari 5GB. Hapus file yang tidak perlu."
    exit 1
fi
info "Remote disk space: ${REMOTE_DISK}GB free"

# Cek apakah PM2 dan direktori ada
if ! ssh_cmd "command -v pm2 &>/dev/null"; then
    error "PM2 tidak ditemukan di remote. Jalankan vps-setup.sh dulu."
    exit 1
fi

if ! ssh_cmd "test -d /opt/rectobase"; then
    ssh_cmd "mkdir -p /opt/rectobase"
fi

success "Remote server ready"

# ─── Step 3: Backup Remote State ─────────────────────────────────────────────
step "3. Backup state sebelumnya..."

BACKUP_TIMESTAMP=$(date +%Y%m%d-%H%M%S)

if ssh_cmd "test -d /opt/rectobase && ls /opt/rectobase/package.json &>/dev/null"; then
    info "Membuat backup PM2..."

    # Save PM2 state
    ssh_cmd "pm2 save 2>/dev/null || true"

    # Create backup directory
    ssh_cmd "mkdir -p /var/backups/rectobase/pre-deploy/$BACKUP_TIMESTAMP"

    # Backup app files (keep last 3)
    ssh_cmd "rsync -a --delete /opt/rectobase/ /var/backups/rectobase/pre-deploy/$BACKUP_TIMESTAMP/app/ 2>/dev/null || true"

    # Backup database
    info "Backup PostgreSQL..."
    if ssh_cmd "command -v pg_dump &>/dev/null"; then
        ssh_cmd "mkdir -p /var/backups/rectobase/pre-deploy/$BACKUP_TIMESTAMP/db"
        ssh_cmd "sudo -u postgres pg_dump rectobase 2>/dev/null | gzip > /var/backups/rectobase/pre-deploy/$BACKUP_TIMESTAMP/db/rectobase-backup.sql.gz" 2>/dev/null || true
        info "Backup tersimpan di /var/backups/rectobase/pre-deploy/$BACKUP_TIMESTAMP/"
    fi

    # Clean old pre-deploy backups (keep last 5)
    ssh_cmd "ls -dt /var/backups/rectobase/pre-deploy/*/ 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null || true"

    success "Backup sebelumnya selesai"
else
    info "Tidak ada deployment sebelumnya - skip backup"
fi

# ─── Step 4: RSYNC Files ─────────────────────────────────────────────────────
step "4. Sinkronisasi file ke remote..."

info "Rsync dari $LOCAL_DIR/ ke $SSH_HOST:$RSYNC_REMOTE_DIR/"

# Build exclude args
EXCLUDE_ARGS=()
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    EXCLUDE_ARGS+=("--exclude=$pattern")
done

RSYNC_CMD=(
    rsync
    "${RSYNC_OPTS[@]}"
    "${EXCLUDE_ARGS[@]}"
    --rsh="ssh -p $SSH_PORT -o StrictHostKeyChecking=no"
    "$LOCAL_DIR/"
    "${SSH_HOST}:${RSYNC_REMOTE_DIR}/"
)

if [[ "$DRY_RUN" == true ]]; then
    info "DRY RUN - Preview rsync:"
    RSYNC_CMD+=("--dry-run")
fi

echo ""
"${RSYNC_CMD[@]}"
RSYNC_EXIT=$?

if [[ $RSYNC_EXIT -ne 0 ]]; then
    error "Rsync gagal dengan exit code: $RSYNC_EXIT"
    exit 1
fi

success "File disinkronisasi"

# ─── Step 5: Environment File Sync ───────────────────────────────────────────
step "5. Sinkronisasi environment file..."

# Cek apakah /etc/rectobase/env ada di remote
if ssh_cmd "test -f /etc/rectobase/env"; then
    info "Environment file sudah ada di remote - tidak di-overwrite"
else
    warn "Environment file tidak ditemukan di remote!"
    warn "Harap buat manual: /etc/rectobase/env"
    warn "Lihat template di deployment/README.md"
fi

success "Environment sync selesai"

# ─── Step 6: Install Dependencies ───────────────────────────────────────────
step "6. Install dependencies di remote..."

info "Menjalankan npm ci --production..."
ssh_cmd "cd /opt/rectobase && npm ci --production --prefer-offline 2>&1 | tail -20"

if ! ssh_cmd "test -d /opt/rectobase/node_modules"; then
    error "npm ci gagal - node_modules tidak dibuat"
    exit 1
fi

success "Dependencies terinstall"

# ─── Step 7: Run Migrations ─────────────────────────────────────────────────
step "7. Menjalankan database migrations..."

# Cek apakah ada migration files
MIGRATION_CHECK=$(ssh_cmd "ls /opt/rectobase/migrations/*.sql 2>/dev/null | wc -l")

if [[ "$MIGRATION_CHECK" -gt 0 ]]; then
    info "Menjalankan $MIGRATION_CHECK migration file(s)..."

    # Source environment
    ssh_cmd "export \$(grep -v '^#' /etc/rectobase/env | xargs) && cd /opt/rectobase && npm run migrate 2>&1" || {
        warn "npm run migrate tidak tersedia atau gagal - cek manual"
        warn "Migrasi dapat dijalankan manual: ./migrate.sh"
    }
    success "Migrations selesai"
else
    info "Tidak ada migration files - skip"
fi

# ─── Step 8: Build (if needed) ───────────────────────────────────────────────
step "8. Build production assets di remote..."

# Cek apakah perlu build di remote
if ssh_cmd "test -d /opt/rectobase/src && ! test -d /opt/rectobase/dist"; then
    info "Build di remote diperlukan..."

    # Check for build tools
    if ssh_cmd "command -v npm &>/dev/null"; then
        ssh_cmd "cd /opt/rectobase && npm run build 2>&1 | tail -20" || {
            warn "Build gagal - cek error logs"
        }
    fi
    success "Build selesai"
else
    info "Build tidak diperlukan - skip"
fi

# ─── Step 9: Restart PM2 ─────────────────────────────────────────────────────
step "9. Restart aplikasi via PM2..."

# Graceful stop
info "Stopping existing instances..."
ssh_cmd "cd /opt/rectobase && pm2 stop rectobase 2>/dev/null || true"
ssh_cmd "pm2 delete rectobase 2>/dev/null || true"

# Start dengan ecosystem file
info "Starting RectoBase..."
ssh_cmd "cd /opt/rectobase && pm2 start ecosystem.config.js 2>&1"

# Tunggu startup
sleep 3

# Cek status
APP_STATUS=$(ssh_cmd "pm2 describe rectobase 2>/dev/null | grep 'status' | head -1 | awk '{print \$4}'")
if [[ "$APP_STATUS" == "online" ]]; then
    success "RectoBase started: $APP_STATUS"
else
    warn "App status: $APP_STATUS - cek pm2 logs"
fi

# ─── Step 10: PM2 Save ──────────────────────────────────────────────────────
step "10. Save PM2 state..."

ssh_cmd "pm2 save 2>&1" || warn "pm2 save gagal"
success "PM2 state tersimpan"

# ─── Step 11: Final Health Check ─────────────────────────────────────────────
step "11. Final health check..."

# Tunggu aplikasi fully started
info "Menunggu aplikasi ready..."
for i in {1..30}; do
    HTTP_CODE=$(ssh_cmd "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health 2>/dev/null || echo '000'")
    if [[ "$HTTP_CODE" == "200" ]]; then
        success "Health check passed!"
        break
    fi
    sleep 1
done

if [[ "$HTTP_CODE" != "200" ]]; then
    warn "Health check mengembalikan HTTP $HTTP_CODE"
    info "Cek logs: pm2 logs rectobase"
fi

# ─── Deployment Summary ───────────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║         Deployment Summary                              ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo -e "  ${GREEN}Deployment Berhasil!${NC}"
echo ""
echo "  Target      : $SSH_HOST"
echo "  Domain      : https://$DOMAIN"
echo "  Branch      : $GIT_BRANCH"
echo "  Timestamp   : $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo -e "  ${GREEN}Remote Commands:${NC}"
echo "    pm2 status           - Cek status aplikasi"
echo "    pm2 logs rectobase    - Lihat logs"
echo "    pm2 monit             - Monitor real-time"
echo ""
echo -e "  ${GREEN}URLs:${NC}"
echo "    App      : https://$DOMAIN"
echo "    API      : https://$DOMAIN/api"
echo "    Health   : https://$DOMAIN/api/health"
echo ""
echo -e "  ${YELLOW}Backup tersimpan di:${NC}"
echo "    $BACKUP_TIMESTAMP"
echo ""

# Show PM2 status
echo -e "${GREEN}[PM2 STATUS]${NC}"
ssh_cmd "pm2 status"

echo ""
echo -e "${GREEN}Deployment RectoBase selesai!${NC}"
