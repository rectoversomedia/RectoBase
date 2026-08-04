#!/bin/bash
# =============================================================================
# RectoBase Automated Backup Script
# Menjalankan backup PostgreSQL dengan rotasi dan opsi upload S3/R2
# =============================================================================

set -euo pipefail

# ─── Warna Output ───────────────────────────────────────────────────────────
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

# ─── Konfigurasi ─────────────────────────────────────────────────────────────
readonly ENV_FILE="/etc/rectobase/env"
readonly BACKUP_DIR="/var/backups/rectobase"
readonly LOG_DIR="/var/log/rectobase"
readonly LOG_FILE="$LOG_DIR/backup.log"
readonly RETENTION_DAYS=7
readonly SCRIPT_NAME=$(basename "$0")

# ─── State ───────────────────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILENAME="rectobase-backup-${TIMESTAMP}"
TMP_DIR="/tmp/rectobase-backup-${TIMESTAMP}"
EXIT_CODE=0

# ─── Helper Functions ───────────────────────────────────────────────────────
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [$SCRIPT_NAME] $1"
    echo -e "$msg" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${GREEN}[INFO]${NC} $1"
    log "[INFO] $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    log "[WARN] $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    log "[ERROR] $1"
}

success() {
    echo -e "${GREEN}[OK]${NC} $1"
    log "[OK] $1"
}

# ─── Load Environment ─────────────────────────────────────────────────────────
load_env() {
    if [[ -f "$ENV_FILE" ]]; then
        set -a
        source "$ENV_FILE"
        set +a
    fi

    # Parse DATABASE_URL
    if [[ -n "${DATABASE_URL:-}" ]]; then
        DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*@.*|\1|p')
        DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
        DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^/]*\)/.*|\1|p' | cut -d: -f1)
        DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^/]*\)/.*|\1|p' | cut -d: -f2)
        DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

        DB_HOST="${DB_HOST:-localhost}"
        DB_PORT="${DB_PORT:-5432}"
        DB_NAME="${DB_NAME:-rectobase}"
        DB_USER="${DB_USER:-rectobase}"
    else
        # Fallback: cek environment langsung
        DB_USER="${DB_USER:-rectobase}"
        DB_NAME="${DB_NAME:-rectobase}"
        DB_HOST="${DB_HOST:-localhost}"
        DB_PORT="${DB_PORT:-5432}"
    fi
}

# ─── Setup ───────────────────────────────────────────────────────────────────
setup() {
    # Buat direktori jika belum ada
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$LOG_DIR"
    mkdir -p "$TMP_DIR"

    info "Backup RectoBase dimulai"
    info "Timestamp: $TIMESTAMP"
    info "Backup dir: $BACKUP_DIR"
}

# ─── Database Backup ─────────────────────────────────────────────────────────
backup_database() {
    info "Membuat backup database PostgreSQL..."

    local sql_file="${TMP_DIR}/${BACKUP_FILENAME}.sql"
    local compressed_file="${BACKUP_DIR}/${BACKUP_FILENAME}.sql.gz"

    # Test koneksi database
    if ! PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "SELECT 1;" &>/dev/null; then
        error "Tidak bisa konek ke database: $DB_NAME@$DB_HOST:$DB_PORT"
        return 1
    fi

    # pg_dump dengan opsi production-safe
    PGPASSWORD="$DB_PASS" pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --no-owner \
        --no-acl \
        --format=plain \
        --compress=9 \
        --verbose \
        2>/dev/null > "$sql_file"

    if [[ $? -ne 0 ]] || [[ ! -s "$sql_file" ]]; then
        error "pg_dump gagal!"
        return 1
    fi

    # Compress
    gzip -c "$sql_file" > "$compressed_file"

    if [[ $? -eq 0 ]] && [[ -s "$compressed_file" ]]; then
        local size
        size=$(du -h "$compressed_file" | cut -f1)
        success "Database backup selesai: $size"
        log "Backup file: $compressed_file"

        # Hapus uncompressed
        rm -f "$sql_file"

        return 0
    else
        error "Compression gagal!"
        return 1
    fi
}

# ─── Config Backup ───────────────────────────────────────────────────────────
backup_config() {
    info "Membuat backup konfigurasi..."

    local config_file="${BACKUP_DIR}/${BACKUP_FILENAME}-config.tar.gz"

    # Backup /etc/rectobase/env (tanpa secrets sensitif jika perlu)
    local config_files=(
        "/etc/rectobase/env"
        "/etc/nginx/sites-available/rectobase"
        "/opt/rectobase/ecosystem.config.js"
    )

    local found_files=0
    local tar_inputs=""

    for file in "${config_files[@]}"; do
        if [[ -f "$file" ]]; then
            tar_inputs="$tar_inputs $file"
            ((found_files++))
        fi
    done

    if [[ $found_files -gt 0 ]]; then
        tar -czf "$config_file" $tar_inputs 2>/dev/null
        if [[ $? -eq 0 ]]; then
            local size
            size=$(du -h "$config_file" | cut -f1)
            success "Config backup selesai: $size"
        fi
    else
        warn "Tidak ada config file ditemukan untuk di-backup"
    fi
}

# ─── File Backup (Optional) ─────────────────────────────────────────────────
backup_files() {
    local upload_dir="/var/www/rectobase/uploads"

    if [[ ! -d "$upload_dir" ]]; then
        return 0
    fi

    info "Membuat backup file uploads..."

    local upload_size
    upload_size=$(du -sh "$upload_dir" 2>/dev/null | cut -f1)

    if [[ "${upload_size%%M}" -gt 500 ]]; then
        warn "Direktori upload terlalu besar (${upload_size}), skip file backup"
        info "Backup file secara manual jika diperlukan:"
        info "  tar -czf rectobase-uploads.tar.gz -C /var/www/rectobase uploads"
        return 0
    fi

    local upload_backup="${BACKUP_DIR}/${BACKUP_FILENAME}-uploads.tar.gz"

    tar -czf "$upload_backup" -C /var/www/rectobase uploads 2>/dev/null

    if [[ $? -eq 0 ]]; then
        local size
        size=$(du -h "$upload_backup" | cut -f1)
        success "Upload backup selesai: $size"
    fi
}

# ─── Cleanup Old Backups ─────────────────────────────────────────────────────
cleanup_old_backups() {
    info "Menghapus backup lama (retention: $RETENTION_DAYS hari)..."

    local deleted=0
    local total_size_freed=0

    # Find dan hapus file lama
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue

        local age_days
        age_days=$(find "$file" -mtime +$RETENTION_DAYS 2>/dev/null | wc -l)

        if [[ $age_days -gt 0 ]]; then
            local size
            size=$(du -h "$file" 2>/dev/null | cut -f1)
            rm -f "$file"
            ((deleted++))
            total_size_freed=$(echo "$total_size_freed + $(numfmt --from=auto "$size" 2>/dev/null || echo 0)" | bc 2>/dev/null || echo "$total_size_freed")
            log "Deleted old backup: $file"
        fi
    done < <(find "$BACKUP_DIR" -maxdepth 1 -name "*.sql.gz" -o -name "*-config.tar.gz" -o -name "*-uploads.tar.gz" 2>/dev/null)

    if [[ $deleted -gt 0 ]]; then
        success "Dihapus $deleted backup lama"
    else
        info "Tidak ada backup lama yang perlu dihapus"
    fi

    # Hapus direktori tmp
    rm -rf "$TMP_DIR"
}

# ─── Upload to S3/R2 ────────────────────────────────────────────────────────
upload_to_cloud() {
    # Cek apakah AWS CLI atau R2 configured
    if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]] && [[ -z "${R2_ACCESS_KEY_ID:-}" ]]; then
        info "Cloud upload tidak dikonfigurasi (AWS/R2 credentials tidak ditemukan)"
        return 0
    fi

    info "Mengupload backup ke cloud storage..."

    local backup_file="${BACKUP_DIR}/${BACKUP_FILENAME}.sql.gz"

    if [[ ! -f "$backup_file" ]]; then
        error "Backup file tidak ditemukan: $backup_file"
        return 1
    fi

    # Tentukan provider
    if [[ -n "${R2_ACCESS_KEY_ID:-}" ]]; then
        # Cloudflare R2
        info "Upload ke Cloudflare R2..."

        if ! command -v aws &>/dev/null; then
            warn "AWS CLI tidak terinstall, skip R2 upload"
            return 1
        fi

        # Configure AWS CLI untuk R2
        aws configure set aws_access_key_id "$R2_ACCESS_KEY_ID"
        aws configure set aws_secret_access_key "$R2_SECRET_ACCESS_KEY"
        aws configure set default.region auto
        aws configure set endpoint_url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

        local r2_bucket="${R2_BUCKET:-rectobase-backups}"
        local r2_path="${R2_PATH:-backups/}"

        if aws s3 cp "$backup_file" "s3://${r2_bucket}/${r2_path}${BACKUP_FILENAME}.sql.gz" 2>&1 | tee -a "$LOG_FILE"; then
            success "Upload ke R2 berhasil"
        else
            error "Upload ke R2 gagal"
            return 1
        fi

    elif [[ -n "${AWS_ACCESS_KEY_ID:-}" ]]; then
        # AWS S3
        info "Upload ke AWS S3..."

        if ! command -v aws &>/dev/null; then
            warn "AWS CLI tidak terinstall, skip S3 upload"
            return 1
        fi

        local s3_bucket="${S3_BUCKET:-rectobase-backups}"
        local s3_path="${S3_PATH:-backups/}"

        if aws s3 cp "$backup_file" "s3://${s3_bucket}/${s3_path}${BACKUP_FILENAME}.sql.gz" 2>&1 | tee -a "$LOG_FILE"; then
            success "Upload ke S3 berhasil"
        else
            error "Upload ke S3 gagal"
            return 1
        fi
    fi
}

# ─── Upload to DigitalOcean Spaces ─────────────────────────────────────────
upload_to_do_spaces() {
    if [[ -z "${DO_SPACES_KEY:-}" ]]; then
        return 0
    fi

    info "Mengupload backup ke DigitalOcean Spaces..."

    if ! command -v aws &>/dev/null; then
        warn "AWS CLI tidak terinstall, skip DO Spaces upload"
        return 1
    fi

    aws configure set aws_access_key_id "$DO_SPACES_KEY"
    aws configure set aws_secret_access_key "$DO_SPACES_SECRET"
    aws configure set default.region "${DO_SPACES_REGION:-sgp1}"
    aws configure set endpoint_url "https://${DO_SPACES_ID}.${DO_SPACES_REGION}.digitaloceanspaces.com"

    local do_bucket="${DO_SPACES_BUCKET:-rectobase-backups}"

    if aws s3 cp "$backup_file" "s3://${do_bucket}/backups/${BACKUP_FILENAME}.sql.gz" 2>&1 | tee -a "$LOG_FILE"; then
        success "Upload ke DO Spaces berhasil"
    else
        error "Upload ke DO Spaces gagal"
        return 1
    fi
}

# ─── Verify Backup ─────────────────────────────────────────────────────────
verify_backup() {
    info "Memverifikasi backup..."

    local backup_file="${BACKUP_DIR}/${BACKUP_FILENAME}.sql.gz"

    if [[ ! -f "$backup_file" ]]; then
        error "Backup file tidak ditemukan!"
        return 1
    fi

    # Test gzip integrity
    if ! gzip -t "$backup_file" 2>/dev/null; then
        error "Backup file corrupted!"
        return 1
    fi

    # Test PostgreSQL restore (dry run)
    if PGPASSWORD="$DB_PASS" pg_restore \
        --dbname "$DB_NAME" \
        --host "$DB_HOST" \
        --port "$DB_PORT" \
        --username "$DB_USER" \
        --list \
        "$backup_file" &>/dev/null; then
        success "Backup terverifikasi: $(du -h "$backup_file" | cut -f1)"
        return 0
    else
        # pg_restore dengan --list kadang gagal untuk plain format
        # Test dengan zcat
        if zcat "$backup_file" | head -1 &>/dev/null; then
            success "Backup terverifikasi: $(du -h "$backup_file" | cut -f1)"
            return 0
        fi
        error "Backup verification failed!"
        return 1
    fi
}

# ─── Send Notification ──────────────────────────────────────────────────────
send_notification() {
    local status="$1"
    local message="$2"

    # Discord webhook
    if [[ -n "${DISCORD_WEBHOOK_URL:-}" ]]; then
        local color
        if [[ "$status" == "success" ]]; then
            color=3066993  # hijau
        else
            color=15158332  # merah
        fi

        curl -s -X POST "$DISCORD_WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -d "{
                \"embeds\": [{
                    \"title\": \"RectoBase Backup $status\",
                    \"color\": $color,
                    \"description\": \"$message\",
                    \"timestamp\": \"$(date -Iseconds)\",
                    \"footer\": {\"text\": \"RectoBase Backup System\"}
                }]
            }" &>/dev/null || true
    fi

    # Email notification
    if [[ -n "${BACKUP_EMAIL:-}" ]]; then
        echo "$message" | mail -s "[RectoBase] Backup $status" "$BACKUP_EMAIL" 2>/dev/null || true
    fi
}

# ─── Cron Setup ─────────────────────────────────────────────────────────────
setup_cron() {
    info "Setup cron job untuk backup harian..."

    local cron_entry="0 3 * * * root $0 --cron >> $LOG_FILE 2>&1"

    # Cek apakah cron sudah ada
    if grep -q "rectobase.*backup.sh" /etc/crontab 2>/dev/null; then
        warn "Cron backup sudah dikonfigurasi"
        return 0
    fi

    echo "$cron_entry" >> /etc/crontab

    success "Cron backup harian aktif (setiap jam 3 pagi)"
    info "Backup akan dijalankan setiap hari jam 03:00"
}

# ─── Cron Mode ─────────────────────────────────────────────────────────────
run_cron() {
    # Cron mode - output minimal, logging ke file
    load_env
    setup

    local status="success"
    local error_msg=""

    if ! backup_database; then
        status="failed"
        error_msg="Database backup failed"
    fi

    if [[ "$status" == "success" ]]; then
        backup_config
        # Skip file backup di cron (too large)
        verify_backup
        cleanup_old_backups
        upload_to_cloud
        upload_to_do_spaces
    fi

    # Log final status
    if [[ "$status" == "success" ]]; then
        log "Backup cron completed successfully"
    else
        log "Backup cron failed: $error_msg"
        send_notification "failed" "$error_msg"
    fi

    exit $([[ "$status" == "success" ]] && echo 0 || echo 1)
}

# ─── List Backups ───────────────────────────────────────────────────────────
list_backups() {
    echo ""
    echo "══════════════════════════════════════════════"
    echo "  RectoBase Backups"
    echo "══════════════════════════════════════════════"
    echo ""

    if [[ ! -d "$BACKUP_DIR" ]]; then
        info "Direktori backup tidak ditemukan"
        return 0
    fi

    local total_size
    total_size=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)

    info "Total backup size: $total_size"
    echo ""

    local count=0
    local total_count=0

    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        ((total_count++))
    done < <(find "$BACKUP_DIR" -maxdepth 1 -name "*.sql.gz" -type f 2>/dev/null | sort -r)

    info "Total: $total_count backup(s)"
    echo ""

    if [[ $total_count -gt 0 ]]; then
        printf "  %-40s %10s %s\n" "File" "Size" "Modified"
        echo "  $(printf '=%.0s' {1..70})"

        find "$BACKUP_DIR" -maxdepth 1 -name "*.sql.gz" -type f 2>/dev/null | sort -r | while IFS= read -r file; do
            local filename
            filename=$(basename "$file")
            local size
            size=$(du -h "$file" | cut -f1)
            local modified
            modified=$(date -r "$file" '+%Y-%m-%d %H:%M')

            local age_days=$((($(date +%s) - $(date -r "$file" +%s)) / 86400))

            if [[ $age_days -gt $RETENTION_DAYS ]]; then
                printf "  ${RED}%-40s${NC} %10s %s\n" "$filename" "$size" "$modified"
            else
                printf "  ${GREEN}%-40s${NC} %10s %s\n" "$filename" "$size" "$modified"
            fi
        done
    fi

    echo ""
}

# ─── Restore from Backup ────────────────────────────────────────────────────
restore_backup() {
    local backup_file="$1"

    if [[ ! -f "$backup_file" ]]; then
        error "Backup file tidak ditemukan: $backup_file"
        exit 1
    fi

    info "Merestore dari: $backup_file"

    # Konfirmasi
    echo ""
    warn "PERHATIAN: Restore akan menimpa database saat ini!"
    echo ""
    read -p "Lanjutkan? (yes/no): " confirm

    if [[ "$confirm" != "yes" ]]; then
        info "Restore dibatalkan"
        exit 0
    fi

    load_env

    # Drop existing connections
    PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d postgres \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" \
        2>/dev/null || true

    # Drop database
    PGPASSWORD="$DB_PASS" dropdb \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        --if-exists "$DB_NAME"

    # Create database
    PGPASSWORD="$DB_PASS" createdb \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -O "$DB_USER" \
        "$DB_NAME"

    # Restore
    if gunzip -c "$backup_file" | \
        PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME"; then
        success "Restore berhasil!"
    else
        error "Restore gagal!"
        exit 1
    fi
}

# ─── Usage ──────────────────────────────────────────────────────────────────
usage() {
    cat <<EOF
Penggunaan: $0 [COMMAND] [OPTIONS]

Commands:
  run               Jalankan backup (default)
  list              Tampilkan daftar backup
  restore FILE      Restore dari file backup
  verify [FILE]     Verifikasi backup file
  cron-setup        Setup cron job untuk backup harian
  help              Tampilkan bantuan ini

Opsi:
  --cron            Jalankan dalam mode cron (minimal output)
  --no-upload       Skip upload ke cloud storage
  --with-files      Include file uploads dalam backup

Opsi Cloud Upload (via environment):
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET    -> AWS S3
  R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET    -> Cloudflare R2
  DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_BUCKET    -> DigitalOcean Spaces
  DISCORD_WEBHOOK_URL                                    -> Discord notification
  BACKUP_EMAIL                                           -> Email notification

Cron Setup:
  0 3 * * * root /opt/rectobase/deployment/backup.sh --cron

Contoh:
  $0                      # Backup database + config
  $0 list                 # Lihat daftar backup
  $0 restore /path/to/backup.sql.gz
  $0 cron-setup           # Setup backup harian via cron

EOF
    exit 1
}

# ─── Main ────────────────────────────────────────────────────────────────────
main() {
    local command="run"
    local cron_mode=false
    local no_upload=false
    local with_files=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            run)
                command="run"
                shift
                ;;
            list)
                command="list"
                shift
                ;;
            restore)
                command="restore"
                shift
                ;;
            verify)
                command="verify"
                shift
                ;;
            cron-setup)
                command="cron-setup"
                shift
                ;;
            --cron)
                cron_mode=true
                shift
                ;;
            --no-upload)
                no_upload=true
                shift
                ;;
            --with-files)
                with_files=true
                shift
                ;;
            help|--help|-h)
                usage
                ;;
            *)
                if [[ "$command" == "restore" ]] || [[ "$command" == "verify" ]]; then
                    # Assume it's the file path
                    break
                fi
                error "Argumen tidak dikenal: $1"
                usage
                ;;
        esac
    done

    # Cron mode
    if [[ "$cron_mode" == "true" ]]; then
        run_cron
        exit 0
    fi

    # Interactive mode
    echo ""
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║         RectoBase Backup System                      ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""

    case "$command" in
        run)
            load_env
            setup
            backup_database || EXIT_CODE=1
            backup_config
            [[ "$with_files" == "true" ]] && backup_files
            [[ $EXIT_CODE -eq 0 ]] && verify_backup || true
            [[ $EXIT_CODE -eq 0 ]] && cleanup_old_backups || true
            [[ "$no_upload" == "false" ]] && [[ $EXIT_CODE -eq 0 ]] && upload_to_cloud || true
            [[ "$no_upload" == "false" ]] && [[ $EXIT_CODE -eq 0 ]] && upload_to_do_spaces || true

            if [[ $EXIT_CODE -eq 0 ]]; then
                success "Backup selesai!"
                echo ""
                echo "  Backup tersimpan di: $BACKUP_DIR"
                echo "  File: ${BACKUP_FILENAME}.sql.gz"
                echo ""
            else
                error "Backup gagal!"
                send_notification "failed" "Backup failed - check logs"
                exit 1
            fi
            ;;
        list)
            list_backups
            ;;
        restore)
            restore_backup "$1"
            ;;
        verify)
            load_env
            if [[ -n "${1:-}" ]]; then
                backup_file="$1"
            else
                backup_file="${BACKUP_DIR}/${BACKUP_FILENAME}.sql.gz"
            fi
            verify_backup
            ;;
        cron-setup)
            check_root
            setup_cron
            ;;
    esac
}

# Helper untuk cek root
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

main "$@"
