#!/bin/bash
# =============================================================================
# RectoBase Rollback Script
# Mengembalikan RectoBase ke versi sebelumnya via PM2 snapshots
# =============================================================================

set -euo pipefail

# ─── Warna Output ───────────────────────────────────────────────────────────
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

# ─── Konfigurasi ─────────────────────────────────────────────────────────────
readonly BACKUP_DIR="/var/backups/rectobase/pre-deploy"
readonly PM2_SNAPSHOT_DIR="/root/.pm2/snapshot"
readonly APP_DIR="/opt/rectobase"
readonly ENV_FILE="/etc/rectobase/env"

# ─── Helper Functions ───────────────────────────────────────────────────────
log() {
    echo -e "${GREEN}[ROLLBACK]${NC} $1"
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

# ─── Cek Root ───────────────────────────────────────────────────────────────
check_root() {
    if [[ $EUID -ne 0 ]]; then
        if command -v sudo &>/dev/null; then
            exec sudo "$0" "$@"
        else
            error "Script ini harus dijalankan sebagai root!"
            exit 1
        fi
    fi
}

# ─── Load Environment ─────────────────────────────────────────────────────────
load_env() {
    if [[ -f "$ENV_FILE" ]]; then
        set -a
        source "$ENV_FILE"
        set +a
    fi
}

# ─── Get PM2 Snapshots ───────────────────────────────────────────────────────
get_pm2_snapshots() {
    if [[ ! -d "$PM2_SNAPSHOT_DIR" ]]; then
        echo ""
        warn "Direktori PM2 snapshot tidak ditemukan: $PM2_SNAPSHOT_DIR"
        info "PM2 tidak menyimpan snapshot. Gunakan file backup manual."
        return 1
    fi

    ls -lt "$PM2_SNAPSHOT_DIR" 2>/dev/null | head -20
}

# ─── Get Pre-deploy Backups ─────────────────────────────────────────────────
get_predeploy_backups() {
    if [[ ! -d "$BACKUP_DIR" ]]; then
        echo ""
        warn "Direktori backup tidak ditemukan: $BACKUP_DIR"
        return 1
    fi

    echo ""
    echo "══════════════════════════════════════════════"
    echo "  Backup Tersedia"
    echo "══════════════════════════════════════════════"
    echo ""

    local count=1
    while IFS= read -r dir; do
        [[ -z "$dir" ]] && continue
        local dirname=$(basename "$dir")
        local size=$(du -sh "$dir" 2>/dev/null | cut -f1)
        local time=$(ls -ld "$dir" 2>/dev/null | awk '{print $6, $7, $8}')
        local has_db=$([[ -d "$dir/db" ]] && echo "DB" || echo "---")

        echo -e "  ${GREEN}$count.${NC} $dirname"
        echo "     Size: $size | DB: $has_db | Time: $time"
        echo ""
        ((count++))
    done < <(ls -dt "$BACKUP_DIR"/*/ 2>/dev/null)
}

# ─── Confirm Rollback ─────────────────────────────────────────────────────────
confirm_rollback() {
    local backup_path="$1"

    echo ""
    echo "══════════════════════════════════════════════"
    echo -e "  ${YELLOW}KONFIRMASI ROLLBACK${NC}"
    echo "══════════════════════════════════════════════"
    echo ""
    echo -e "  Backup : $backup_path"
    echo ""
    echo -e "  ${RED}PERHATIAN:${NC}"
    echo "    - Aplikasi akan di-restart"
    echo "    - Database migration akan di-rollback"
    echo "    - Data mungkin hilang jika ada perubahan yang tidak ter-capture"
    echo ""
    read -p "  Lanjutkan rollback? (yes/no): " confirm

    if [[ "$confirm" != "yes" ]]; then
        info "Rollback dibatalkan."
        exit 0
    fi
}

# ─── Rollback Application Files ───────────────────────────────────────────────
rollback_files() {
    local backup_path="$1"

    step "Mengembalikan file aplikasi..."

    if [[ ! -d "$backup_path/app" ]]; then
        error "Backup app directory tidak ditemukan: $backup_path/app"
        return 1
    fi

    # Backup current state dulu
    local current_backup="/var/backups/rectobase/pre-rollback-$(date +%Y%m%d-%H%M%S)"
    info "Backup state saat ini ke: $current_backup"

    mkdir -p "$current_backup"
    cp -a "$APP_DIR"/. "$current_backup/app/" 2>/dev/null || cp -a "$APP_DIR" "$current_backup/app"

    # Restore dari backup
    info "Merestore file dari: $backup_path/app/"
    rsync -a --delete "$backup_path/app/" "$APP_DIR/"

    success "File aplikasi di-restore"
}

# ─── Rollback Database ─────────────────────────────────────────────────────────
rollback_database() {
    local backup_path="$1"

    step "Merestore database..."

    if [[ ! -f "$backup_path/db/rectobase-backup.sql.gz" ]]; then
        warn "Backup database tidak ditemukan di: $backup_path/db/"
        info "Rollback database dilewati"
        return 0
    fi

    # Parse database credentials dari env
    if [[ -z "${DATABASE_URL:-}" ]]; then
        warn "DATABASE_URL tidak ditemukan di $ENV_FILE"
        warn "Rollback database dilewati"
        return 0
    fi

    local DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*@.*|\1|p')
    local DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
    local DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')
    local DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^/]*\)/.*|\1|p' | cut -d: -f1)

    info "Merestore database: $DB_NAME"

    # Drop existing connections
    PGPPASSWORD="$DB_PASS" psql \
        -h "${DB_HOST:-localhost}" \
        -U "$DB_USER" \
        -d postgres \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" \
        2>/dev/null || true

    # Drop dan recreate database
    PGPASSWORD="$DB_PASS" dropdb \
        -h "${DB_HOST:-localhost}" \
        -U "$DB_USER" \
        --if-exists "$DB_NAME" 2>/dev/null || true

    PGPASSWORD="$DB_PASS" createdb \
        -h "${DB_HOST:-localhost}" \
        -U "$DB_USER" \
        -O "$DB_USER" \
        "$DB_NAME" 2>/dev/null || true

    # Restore
    if gunzip -c "$backup_path/db/rectobase-backup.sql.gz" | \
        PGPASSWORD="$DB_PASS" psql \
        -h "${DB_HOST:-localhost}" \
        -U "$DB_USER" \
        -d "$DB_NAME" 2>/dev/null; then
        success "Database di-restore"
    else
        error "Restore database gagal!"
        return 1
    fi
}

# ─── Restart Application ──────────────────────────────────────────────────────
restart_app() {
    step "Merestart RectoBase..."

    cd "$APP_DIR"

    # Stop current
    pm2 stop rectobase 2>/dev/null || true
    pm2 delete rectobase 2>/dev/null || true

    # Start dengan ecosystem file
    if [[ -f "$APP_DIR/ecosystem.config.js" ]]; then
        pm2 start "$APP_DIR/ecosystem.config.js"
    else
        # Fallback: start langsung
        pm2 start dist/index.js --name rectobase \
            --max-memory-restart 512M \
            --env production
    fi

    # Wait for startup
    sleep 5

    # Check status
    local status
    status=$(pm2 describe rectobase 2>/dev/null | grep "status" | head -1 | awk '{print $4}')

    if [[ "$status" == "online" ]]; then
        success "RectoBase restarted: $status"
    else
        warn "Status: $status"
        info "Cek logs: pm2 logs rectobase"
    fi

    # Save state
    pm2 save
}

# ─── Quick Rollback (Last Backup) ───────────────────────────────────────────
quick_rollback() {
    info "Melakukan quick rollback ke backup terakhir..."

    local latest_backup
    latest_backup=$(ls -dt "$BACKUP_DIR"/*/ 2>/dev/null | head -1)

    if [[ -z "$latest_backup" ]]; then
        error "Tidak ada backup ditemukan!"
        exit 1
    fi

    confirm_rollback "$latest_backup"
    rollback_files "$latest_backup"
    rollback_database "$latest_backup"
    restart_app

    echo ""
    success "Rollback selesai!"
}

# ─── Select Backup Interactive ──────────────────────────────────────────────
interactive_select() {
    echo ""
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║         RectoBase Interactive Rollback                ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""

    # Dapatkan daftar backup
    local backups
    backups=$(ls -dt "$BACKUP_DIR"/*/ 2>/dev/null)

    if [[ -z "$backups" ]]; then
        error "Tidak ada backup ditemukan!"
        exit 1
    fi

    # Tampilkan daftar
    local count=0
    local backup_list=()

    echo "  Pilih backup untuk di-restore:"
    echo ""

    while IFS= read -r dir; do
        [[ -z "$dir" ]] && continue
        ((count++))
        local dirname=$(basename "$dir")
        local size=$(du -sh "$dir" 2>/dev/null | cut -f1)
        local time=$(ls -ld "$dir" 2>/dev/null | awk '{print $6, $7, $8}')
        local has_db=$([[ -d "$dir/db" ]] && echo "DB" || echo "---")
        local has_app=$([[ -d "$dir/app" ]] && echo "App" || echo "---")

        backup_list+=("$dir")
        echo -e "  ${GREEN}$count.${NC} $dirname"
        echo "     Size: $size | Components: $has_app + $has_db | Time: $time"
        echo ""
    done <<< "$backups"

    echo "  0. Batalkan"
    echo ""
    read -p "  Pilihan [1-$count, 0 untuk batal]: " choice

    if [[ "$choice" == "0" ]]; then
        info "Rollback dibatalkan."
        exit 0
    fi

    if [[ ! "$choice" =~ ^[0-9]+$ ]] || \
       [[ "$choice" -lt 1 ]] || \
       [[ "$choice" -gt $count ]]; then
        error "Pilihan tidak valid: $choice"
        exit 1
    fi

    local selected_backup="${backup_list[$((choice - 1))]}"
    confirm_rollback "$selected_backup"
    rollback_files "$selected_backup"
    rollback_database "$selected_backup"
    restart_app

    echo ""
    success "Rollback selesai!"
}

# ─── Show Rollback History ───────────────────────────────────────────────────
show_history() {
    echo ""
    echo "══════════════════════════════════════════════"
    echo "  PM2 Snapshot History"
    echo "══════════════════════════════════════════════"
    echo ""

    if [[ ! -d "$PM2_SNAPSHOT_DIR" ]]; then
        info "Tidak ada PM2 snapshot tersimpan"
    else
        ls -lt "$PM2_SNAPSHOT_DIR" 2>/dev/null | head -10
    fi

    echo ""
    get_predeploy_backups
}

# ─── Usage ───────────────────────────────────────────────────────────────────
usage() {
    cat <<EOF
Penggunaan: $0 [OPTIONS] [COMMAND]

Rollback RectoBase ke versi sebelumnya.

COMMANDS:
  list                    Tampilkan daftar backup yang tersedia
  quick                   Rollback ke backup terakhir (otomatis)
  interactive             Pilih backup secara interaktif
  history                 Tampilkan history PM2 snapshots
  help                    Tampilkan bantuan ini

OPTIONS:
  --backup PATH           Path ke backup yang akan di-restore
  --files-only            Hanya restore file, skip database
  --db-only               Hanya restore database, skip file

CONTOH:
  $0 list                                    # Lihat daftar backup
  $0 quick                                   # Rollback ke backup terakhir
  $0 interactive                             # Pilih backup via menu
  $0 --backup /path/to/backup                # Restore backup tertentu
  $0 --backup /path/to/backup --files-only   # Hanya file, skip DB

EOF
    exit 1
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    check_root
    load_env

    local command="${1:-interactive}"
    local backup_path=""
    local files_only=false
    local db_only=false

    # Parse options
    while [[ $# -gt 0 ]]; do
        case "$1" in
            list)
                command="list"
                shift
                ;;
            quick)
                command="quick"
                shift
                ;;
            interactive)
                command="interactive"
                shift
                ;;
            history)
                command="history"
                shift
                ;;
            help|--help|-h)
                usage
                ;;
            --backup)
                backup_path="$2"
                shift 2
                ;;
            --files-only)
                files_only=true
                shift
                ;;
            --db-only)
                db_only=true
                shift
                ;;
            *)
                error "Argumen tidak dikenal: $1"
                usage
                ;;
        esac
    done

    echo ""
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║         RectoBase Rollback Script                     ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""

    case "$command" in
        list)
            get_predeploy_backups
            ;;
        quick)
            quick_rollback
            ;;
        interactive)
            interactive_select
            ;;
        history)
            show_history
            ;;
        *)
            # Assume backup path sebagai argumen
            if [[ -n "$backup_path" ]]; then
                confirm_rollback "$backup_path"
                if [[ "$db_only" == "true" ]]; then
                    rollback_database "$backup_path"
                    restart_app
                elif [[ "$files_only" == "true" ]]; then
                    rollback_files "$backup_path"
                    restart_app
                else
                    rollback_files "$backup_path"
                    rollback_database "$backup_path"
                    restart_app
                fi
                success "Rollback selesai!"
            else
                usage
            fi
            ;;
    esac
}

main "$@"
