#!/bin/bash
# =============================================================================
# RectoBase Database Migration Runner
# Menjalankan SQL migration files secara berurutan
# Idempotent - aman dijalankan berulang kali
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
readonly MIGRATIONS_DIR="${MIGRATIONS_DIR:-/opt/rectobase/migrations}"
readonly LOG_DIR="/var/log/rectobase"
readonly LOG_FILE="$LOG_DIR/migrations.log"

# ─── Helper Functions ────────────────────────────────────────────────────────
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo -e "$msg"
    echo "$msg" >> "$LOG_FILE"
}

step() {
    echo -e "${GREEN}[STEP]${NC} $1"
    log "[STEP] $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
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

# ─── Cek Root ───────────────────────────────────────────────────────────────
check_root() {
    if [[ $EUID -ne 0 ]]; then
        # Coba dengan sudo jika ada
        if command -v sudo &>/dev/null; then
            exec sudo "$0" "$@"
        else
            error "Script ini harus dijalankan sebagai root!"
            exit 1
        fi
    fi
}

# ─── Load Environment ────────────────────────────────────────────────────────
load_env() {
    if [[ ! -f "$ENV_FILE" ]]; then
        error "Environment file tidak ditemukan: $ENV_FILE"
        error "Jalankan vps-setup.sh dulu, atau buat $ENV_FILE"
        exit 1
    fi

    # Parse env file - hanya export variabel yang ada
    while IFS='=' read -r key value; do
        # Skip comments dan empty lines
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        [[ "$key" =~ ^[[:space:]]*$ ]] && continue

        # Trim whitespace
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | xargs)

        # Skip jika value kosong
        [[ -z "$value" ]] && continue

        # Export
        export "$key=$value"
    done < "$ENV_FILE"

    # Validate DATABASE_URL
    if [[ -z "${DATABASE_URL:-}" ]]; then
        error "DATABASE_URL tidak ditemukan di $ENV_FILE"
        exit 1
    fi

    # Parse DATABASE_URL components
    DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*@.*|\1|p')
    DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^/]*\)/.*|\1|p' | cut -d: -f1)
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^/]*\)/.*|\1|p' | cut -d: -f2)
    DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

    # Fallback defaults
    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
    DB_NAME="${DB_NAME:-rectobase}"
    DB_USER="${DB_USER:-rectobase}"
}

# ─── Cek Koneksi Database ────────────────────────────────────────────────────
check_db_connection() {
    step "Menguji koneksi ke PostgreSQL..."

    local max_attempts=10
    local attempt=1

    while [[ $attempt -le $max_attempts ]]; do
        if PGPASSWORD="$DB_PASS" psql \
            -h "$DB_HOST" \
            -p "${DB_PORT:-5432}" \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            -c "SELECT 1;" &>/dev/null; then
            success "Koneksi PostgreSQL OK (host=$DB_HOST, db=$DB_NAME)"
            return 0
        fi

        warn "Attempt $attempt/$max_attempts - koneksi gagal, retry dalam 3 detik..."
        sleep 3
        ((attempt++))
    done

    error "Tidak bisa konek ke PostgreSQL setelah $max_attempts percobaan"
    error "Host: $DB_HOST:$DB_PORT, DB: $DB_NAME, User: $DB_USER"
    return 1
}

# ─── Buat Migration Tracking Table ───────────────────────────────────────────
setup_migration_table() {
    step "Setup migration tracking table..."

    local create_table_sql="
        CREATE TABLE IF NOT EXISTS _migrations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            checksum VARCHAR(64),
            batch INTEGER DEFAULT 1
        );
    "

    PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "${DB_PORT:-5432}" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "$create_table_sql" &>/dev/null

    success "Migration tracking table siap"
}

# ─── Get Applied Migrations ─────────────────────────────────────────────────
get_applied_migrations() {
    PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "${DB_PORT:-5432}" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -t \
        -c "SELECT name FROM _migrations ORDER BY id;" 2>/dev/null | grep -v '^$' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

# ─── Calculate File Checksum ────────────────────────────────────────────────
calculate_checksum() {
    sha256sum "$1" | awk '{print $1}'
}

# ─── Run Single Migration ────────────────────────────────────────────────────
run_migration() {
    local file="$1"
    local filename=$(basename "$file")
    local checksum=$(calculate_checksum "$file")

    info "Menerapkan migration: $filename"

    # Run migration dalam transaction
    local result
    result=$(PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "${DB_PORT:-5432}" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -1 \
        -c "\\i $file" 2>&1)

    local exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        # Record successful migration
        PGPASSWORD="$DB_PASS" psql \
            -h "$DB_HOST" \
            -p "${DB_PORT:-5432}" \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            -c "INSERT INTO _migrations (name, checksum) VALUES ('$filename', '$checksum') ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW();" \
            &>/dev/null

        success "Migration berhasil: $filename"
        return 0
    else
        error "Migration gagal: $filename"
        echo "$result" | grep -v "^$" | head -20
        return 1
    fi
}

# ─── Rollback Migration ──────────────────────────────────────────────────────
rollback_migration() {
    local filename="$1"

    warn "Rolling back: $filename"

    # Generate rollback filename
    local rollback_file="${filename%.sql}-rollback.sql"

    if [[ -f "$rollback_file" ]]; then
        info "Menjalankan rollback dari: $rollback_file"

        PGPASSWORD="$DB_PASS" psql \
            -h "$DB_HOST" \
            -p "${DB_PORT:-5432}" \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            -1 \
            -c "\\i $rollback_file" 2>&1

        PGPASSWORD="$DB_PASS" psql \
            -h "$DB_HOST" \
            -p "${DB_PORT:-5432}" \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            -c "DELETE FROM _migrations WHERE name = '$filename';" \
            &>/dev/null

        success "Rollback berhasil: $filename"
    else
        warn "Rollback file tidak ditemukan: $rollback_file"
        warn "Manual rollback diperlukan untuk: $filename"
    fi
}

# ─── Main Migration Runner ───────────────────────────────────────────────────
run_migrations() {
    # Buat log dir
    mkdir -p "$LOG_DIR"

    echo ""
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║         RectoBase Database Migration Runner            ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""

    step "Memulai proses migrasi..."
    info "Migrations dir : $MIGRATIONS_DIR"
    info "Database       : $DB_NAME@$DB_HOST:$DB_PORT"
    info "Log file       : $LOG_FILE"
    echo ""

    # Cek migrations directory
    if [[ ! -d "$MIGRATIONS_DIR" ]]; then
        warn "Migrations directory tidak ada: $MIGRATIONS_DIR"
        info "Membuat directory..."
        mkdir -p "$MIGRATIONS_DIR"
        success "Directory dibuat"
        return 0
    fi

    # Cek apakah ada SQL files
    local migration_files
    migration_files=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" | sort)

    if [[ -z "$migration_files" ]]; then
        info "Tidak ada migration files ditemukan di $MIGRATIONS_DIR"
        return 0
    fi

    # Setup tracking table
    setup_migration_table

    # Get already applied migrations
    local applied_migrations
    applied_migrations=$(get_applied_migrations)
    local applied_count=$(echo "$applied_migrations" | grep -c . || echo 0)

    info "Total migrations : $(echo "$migration_files" | wc -l | xargs)"
    info "Sudah diterapkan : $applied_count"
    echo ""

    # Counter
    local applied=0
    local failed=0
    local skipped=0

    # Run each migration
    for file in $migration_files; do
        local filename=$(basename "$file")

        # Check if already applied
        if echo "$applied_migrations" | grep -qxF "$filename"; then
            info "Skip (sudah diterapkan): $filename"
            ((skipped++))
            continue
        fi

        # Run migration
        if run_migration "$file"; then
            ((applied++))
        else
            error "Migration gagal - stopping!"
            ((failed++))
            break
        fi
    done

    # Summary
    echo ""
    echo "══════════════════════════════════════════════"
    echo -e "  ${GREEN}Migration Summary${NC}"
    echo "══════════════════════════════════════════════"
    echo "  Applied : $applied"
    echo "  Skipped : $skipped"
    echo "  Failed  : $failed"
    echo "══════════════════════════════════════════════"
    echo ""

    if [[ $failed -gt 0 ]]; then
        error "Migration gagal! Cek log: $LOG_FILE"
        exit 1
    fi

    success "Semua migration berhasil diterapkan!"
    return 0
}

# ─── List Migrations ──────────────────────────────────────────────────────────
list_migrations() {
    echo ""
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║         Daftar Migrations                              ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""

    step "Migrations yang sudah diterapkan:"
    echo ""

    local applied
    applied=$(get_applied_migrations)

    if [[ -z "$applied" ]]; then
        info "Belum ada migrations yang diterapkan"
    else
        while IFS= read -r name; do
            [[ -z "$name" ]] && continue
            echo -e "  ${GREEN}[APPLIED]${NC} $name"
        done <<< "$applied"
    fi

    echo ""
    step "Migrations yang belum diterapkan:"

    local all_files
    all_files=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" -exec basename {} \; 2>/dev/null | sort)

    if [[ -z "$all_files" ]]; then
        info "Tidak ada migration files"
    else
        while IFS= read -r filename; do
            [[ -z "$filename" ]] && continue
            if echo "$applied" | grep -qxF "$filename"; then
                continue
            fi
            echo -e "  ${YELLOW}[PENDING]${NC} $filename"
        done <<< "$all_files"
    fi

    echo ""
}

# ─── Rollback Last ────────────────────────────────────────────────────────────
rollback_last() {
    local count="${1:-1}"

    step "Rollback $count migration(s) terakhir..."

    local last_migrations
    last_migrations=$(PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "${DB_PORT:-5432}" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -t \
        -c "SELECT name FROM _migrations ORDER BY id DESC LIMIT $count;" 2>/dev/null)

    if [[ -z "$last_migrations" ]]; then
        info "Tidak ada migrations untuk di-rollback"
        return 0
    fi

    local rolled_back=0
    while IFS= read -r filename; do
        [[ -z "$filename" ]] && continue
        if rollback_migration "$filename"; then
            ((rolled_back++))
        fi
    done <<< "$last_migrations"

    success "Rollback $rolled_back migration(s)"
}

# ─── CLI Interface ───────────────────────────────────────────────────────────
show_usage() {
    cat <<EOF
Penggunaan: $0 [COMMAND] [OPTIONS]

Commands:
  run            Jalankan semua pending migrations (default)
  list           Tampilkan daftar migrations
  status         Tampilkan status migrations
  rollback [N]   Rollback N migration terakhir (default: 1)
  help           Tampilkan bantuan ini

Opsi:
  --env FILE     Path ke environment file (default: /etc/rectobase/env)
  --dir DIR      Path ke migrations directory (default: /opt/rectobase/migrations)

Contoh:
  $0                  # Jalankan semua pending migrations
  $0 list             # Tampilkan semua migrations
  $0 rollback 2       # Rollback 2 migration terakhir
  $0 --dir /custom/path/migrations  # Custom migrations dir

EOF
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    # Setup log directory
    mkdir -p "$LOG_DIR"

    local command="${1:-run}"

    case "$command" in
        run|up)
            check_root
            load_env
            check_db_connection
            run_migrations
            ;;
        list)
            check_root
            load_env
            check_db_connection || true
            list_migrations
            ;;
        status)
            check_root
            load_env
            check_db_connection || true
            list_migrations
            ;;
        rollback|down)
            check_root
            load_env
            check_db_connection
            rollback_last "${2:-1}"
            ;;
        help|--help|-h)
            show_usage
            ;;
        *)
            error "Command tidak dikenal: $command"
            show_usage
            exit 1
            ;;
    esac
}

main "$@"
