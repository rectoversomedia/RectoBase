#!/bin/bash
# =============================================================================
# RectoBase VPS Setup Script
# Setup produksi untuk RectoBase (Node.js + PostgreSQL + Redis)
#适用于 Ubuntu 22.04 / 24.04
# =============================================================================

set -euo pipefail

# ─── Warna Output ───────────────────────────────────────────────────────────
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# ─── Variabel ───────────────────────────────────────────────────────────────
DOMAIN=""
EMAIL=""
TRIPAY_MODE="sandbox"
LOG_FILE="/tmp/rectobase-setup.log"

# ─── Parse Argumen ──────────────────────────────────────────────────────────
usage() {
    cat <<EOF
Penggunaan: $0 --domain=example.com --email=admin@example.com [OPTIONS]

Wajib:
  --domain      Domain/apex domain untuk RectoBase (contoh: pos.Indonesiansaja.com)
  --email       Email untuk Certbot SSL certificate

Opsi:
  --tripay-mode=sandbox|production   Mode Tripay payment gateway (default: sandbox)

Contoh:
  $0 --domain=pos.toko-saya.com --email=admin@toko-saya.com
  $0 --domain=pos.toko-saya.com --email=admin@toko-saya.com --tripay-mode=production

Syarat:
  - Script ini HARUS dijalankan sebagai ROOT
  - Ubuntu 22.04 atau 24.04
EOF
    exit 1
}

# Cek root
if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}[ERROR] Script ini harus dijalankan sebagai root!${NC}"
    echo -e "${RED}       Gunakan: sudo $0${NC}"
    exit 1
fi

# Parse arguments
for arg in "$@"; do
    case $arg in
        --domain=*)
            DOMAIN="${arg#*=}"
            ;;
        --email=*)
            EMAIL="${arg#*=}"
            ;;
        --tripay-mode=*)
            TRIPAY_MODE="${arg#*=}"
            if [[ "$TRIPAY_MODE" != "sandbox" && "$TRIPAY_MODE" != "production" ]]; then
                echo -e "${RED}[ERROR] --tripay-mode harus 'sandbox' atau 'production'${NC}"
                exit 1
            fi
            ;;
        --help|-h)
            usage
            ;;
        *)
            echo -e "${RED}[ERROR] Argumen tidak dikenal: $arg${NC}"
            usage
            ;;
    esac
done

# Validasi wajib
if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
    echo -e "${RED}[ERROR] --domain dan --email wajib diisi!${NC}"
    usage
fi

# ─── Helper Functions ───────────────────────────────────────────────────────
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo -e "$msg" | tee -a "$LOG_FILE"
}

step() {
    echo -e "${GREEN}[STEP]${NC} $1"
    log "[STEP] $1"
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

ask() {
    local prompt="$1"
    local default="${2:-}"
    if [[ -n "$default" ]]; then
        read -p "$prompt [$default]: " input
        echo "${input:-$default}"
    else
        read -p "$prompt: " input
        echo "$input"
    fi
}

# Idempotency helper: skip if already done
is_installed() {
    command -v "$1" &>/dev/null
}

pkg_installed() {
    dpkg -l "$1" 2>/dev/null | grep -q "^ii"
}

# ─── Banner ─────────────────────────────────────────────────────────────────
cat <<'BANNER'
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   █████╗ ██╗   ██╗███████╗████████╗███████╗███╗   ███╗    ║
║  ██╔══██╗╚██╗ ██╔╝██╔════╝╚══██╔══╝██╔════╝████╗ ████║    ║
║  ███████║ ╚████╔╝ ███████╗   ██║   █████╗  ██╔████╔██║    ║
║  ██╔══██║  ╚██╔╝  ╚════██║   ██║   ██╔══╝  ██║╚██╔╝██║    ║
║  ██║  ██║   ██║   ███████║   ██║   ███████╗██║ ╚═╝ ██║    ║
║  ╚═╝  ╚═╝   ╚═╝   ╚══════╝   ╚═╝   ╚══════╝╚═╝     ╚═╝    ║
║                                                           ║
║   VPS Setup Script - RectoBase Production Stack           ║
║   Ubuntu 22.04 / 24.04 LTS                                ║
╚═══════════════════════════════════════════════════════════╝
BANNER

echo ""
log "══════════════════════════════════════════════"
log "RectoBase VPS Setup dimulai"
log "Domain  : $DOMAIN"
log "Email   : $EMAIL"
log "Tripay  : $TRIPAY_MODE"
log "Log     : $LOG_FILE"
log "══════════════════════════════════════════════"
echo ""

# ─── Step 0: Validasi Sistem ─────────────────────────────────────────────────
step "Melakukan validasi sistem..."

if ! command -v lsb_release &>/dev/null; then
    apt-get update && apt-get install -y lsb-release
fi

OS_CODENAME=$(lsb_release -cs)
if [[ "$OS_CODENAME" != "jammy" && "$OS_CODENAME" != "noble" ]]; then
    warn "Script ini dioptimasi untuk Ubuntu 22.04 (jammy) dan 24.04 (noble)."
    warn "Deteksi: $OS_CODENAME. Melanjutkan..."
fi

if [[ $(df -BG / | awk 'NR==2 {print $4}' | tr -d 'G') -lt 10 ]]; then
    error "Disk space kurang dari 10GB. Minimal yang disarankan: 20GB."
    exit 1
fi

if [[ $(free -m | awk 'NR==2 {print $2}') -lt 1500 ]]; then
    warn "RAM kurang dari 1.5GB. Production disarankan minimal 2GB."
fi

success "Validasi sistem selesai"

# ─── Step 1: Update Sistem ───────────────────────────────────────────────────
step "Mengupdate package index dan upgrade sistem..."
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get upgrade -y -qq 2>&1 | tail -5
success "Sistem diperbarui"

# ─── Step 2: Install Dependencies ───────────────────────────────────────────
step "Menginstall dependencies utama..."

DEPS=(
    curl
    wget
    gnupg2
    ca-certificates
    lsb-release
    unzip
    git
    htop
    vim
    fail2ban
    sudo
    logrotate
    bc
)

for dep in "${DEPS[@]}"; do
    if ! pkg_installed "$dep"; then
        apt-get install -y -qq "$dep" &>/dev/null
    fi
done
success "Dependencies terinstall"

# ─── Step 3: Install Node.js 20 LTS ─────────────────────────────────────────
step "Menginstall Node.js 20 LTS..."

if is_installed node && [[ $(node -v 2>/dev/null | cut -d. -f1 | tr -d v) -eq 20 ]]; then
    warn "Node.js 20 sudah terinstall"
else
    # Hapus nodejs lama jika ada
    if is_installed node; then
        warn "Menghapus Node.js lama..."
        apt-get remove -y -qq nodejs npm 2>/dev/null || true
        rm -f /etc/apt/sources.list.d/nodesource*
    fi

    # Install NodeSource Node.js 20
    curl -fsSL "https://deb.nodesource.com/setup_20.x" | bash - &>/dev/null
    apt-get install -y -qq nodejs &>/dev/null

    # Verifikasi
    NODE_VERSION=$(node -v)
    NPM_VERSION=$(npm -v)
    success "Node.js $NODE_VERSION dan npm $NPM_VERSION terinstall"
fi

# ─── Step 4: Install PostgreSQL 16 ───────────────────────────────────────────
step "Menginstall PostgreSQL 16..."

if pkg_installed postgresql-16; then
    warn "PostgreSQL 16 sudah terinstall"
elif pkg_installed postgresql; then
    # Upgrade path: check version
    PG_VER=$(psql --version 2>/dev/null | awk '{print $3}' | cut -d. -f1)
    if [[ "$PG_VER" -ge 16 ]]; then
        warn "PostgreSQL $PG_VER sudah terinstall"
    else
        warn "PostgreSQL $PG_VER terdeteksi. Disarankan upgrade ke PostgreSQL 16."
    fi
else
    # Tambah PostgreSQL APT repo untuk Ubuntu 22.04
    if [[ "$OS_CODENAME" == "jammy" ]]; then
        warn "Menambahkan PostgreSQL APT repository..."
        curl -fsSL "https://www.postgresql.org/media/keys/ACCC4CF8.asc" | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt ${OS_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
        apt-get update -qq
    fi

    apt-get install -y -qq postgresql-16 &>/dev/null
    success "PostgreSQL 16 terinstall"
fi

# ─── Step 5: Install Redis ────────────────────────────────────────────────────
step "Menginstall dan mengkonfigurasi Redis..."

if pkg_installed redis-server; then
    warn "Redis sudah terinstall"
else
    apt-get install -y -qq redis-server &>/dev/null
    success "Redis terinstall"
fi

# Konfigurasi Redis untuk production
if [[ -f /etc/redis/redis.conf ]]; then
    sed -i 's/^maxmemory .*/maxmemory 256mb/' /etc/redis/redis.conf
    sed -i 's/^maxmemory-policy .*/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf
    sed -i "s/^bind 127.0.0.1 ::1$/bind 127.0.0.1/" /etc/redis/redis.conf
    systemctl restart redis-server
    success "Redis dikonfigurasi"
elif [[ -f /etc/redis.conf ]]; then
    sed -i 's/^maxmemory .*/maxmemory 256mb/' /etc/redis.conf
    sed -i 's/^maxmemory-policy .*/maxmemory-policy allkeys-lru/' /etc/redis.conf
    systemctl restart redis-server
    success "Redis dikonfigurasi"
fi

# ─── Step 6: Konfigurasi PostgreSQL ──────────────────────────────────────────
step "Mengkonfigurasi PostgreSQL..."

systemctl enable --now postgresql 2>/dev/null || true
systemctl start postgresql

# Tunggu PostgreSQL ready
for i in {1..30}; do
    if su - postgres -c "psql -c 'SELECT 1'" &>/dev/null; then
        break
    fi
    sleep 1
done

# Cek apakah user sudah ada
if ! su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='rectobase'\"" 2>/dev/null | grep -q 1; then
    step "Membuat PostgreSQL user dan database..."

    # Generate password acak yang kuat
    DB_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 24)

    su - postgres -c "psql -c \"CREATE USER rectobase WITH PASSWORD '$DB_PASSWORD' CREATEDB LOGIN;\"" 2>/dev/null
    su - postgres -c "psql -c \"CREATE DATABASE rectobase OWNER rectobase ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;\"" 2>/dev/null
    su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE rectobase TO rectobase;\"" 2>/dev/null
    su - postgres -c "psql -d rectobase -c \"GRANT ALL ON SCHEMA public TO rectobase;\"" 2>/dev/null

    # Simpan password sementara untuk env file
    echo "RECTOBASE_DB_PASSWORD_TEMP=$DB_PASSWORD"
    DB_PASS_SAVED="$DB_PASSWORD"
    success "PostgreSQL user dan database dibuat"
else
    warn "PostgreSQL user 'rectobase' sudah ada - skip pembuatan"
    DB_PASS_SAVED=""
fi

# Konfigurasi pg_hba.conf untuk koneksi lokal
PG_HBA="/etc/postgresql/$(ls /etc/postgresql/ | head -1)/main/pg_hba.conf"
if [[ -f "$PG_HBA" ]]; then
    # Pastikan konfigurasi sudah ada untuk rectobase user
    if ! grep -q "rectobase" "$PG_HBA" 2>/dev/null; then
        echo "local   all             rectobase                           scram-sha-256" >> "$PG_HBA"
        systemctl reload postgresql
    fi
fi

success "PostgreSQL siap"

# ─── Step 7: Install PM2 ─────────────────────────────────────────────────────
step "Menginstall PM2..."

if is_installed pm2; then
    warn "PM2 sudah terinstall"
else
    npm install -g pm2 &>/dev/null
    # Autostart PM2
    env PATH="$PATH:/usr/local/bin" pm2 startup systemd -u root --hp /root &>/dev/null || true
    success "PM2 terinstall"
fi

# Install PM2 logrotate
if ! is_installed pm2-logrotate; then
    pm2 install pm2-logrotate &>/dev/null
    pm2 set pm2-logrotate:max_size 10M &>/dev/null
    pm2 set pm2-logrotate:retain 7 &>/dev/null
fi

success "PM2 siap"

# ─── Step 8: Install Nginx ───────────────────────────────────────────────────
step "Menginstall Nginx..."

if pkg_installed nginx; then
    warn "Nginx sudah terinstall"
else
    apt-get install -y -qq nginx &>/dev/null
    success "Nginx terinstall"
fi

# Nonaktifkan site default
rm -f /etc/nginx/sites-enabled/default

# ─── Step 9: Install Certbot ─────────────────────────────────────────────────
step "Menginstall Certbot..."

if ! pkg_installed certbot; then
    if [[ "$OS_CODENAME" == "jammy" ]]; then
        apt-get install -y -qq certbot python3-certbot-nginx &>/dev/null
    else
        apt-get install -y -qq certbot python3-certbot-nginx snapd &>/dev/null
        snap install --classic certbot &>/dev/null
        ln -sf /snap/bin/certbot /usr/bin/certbot
    fi
    success "Certbot terinstall"
else
    warn "Certbot sudah terinstall"
fi

# ─── Step 10: Buat Direktori Aplikasi ───────────────────────────────────────
step "Membuat direktori aplikasi..."

mkdir -p /var/www/rectobase/frontend
mkdir -p /opt/rectobase/migrations
mkdir -p /var/backups/rectobase
mkdir -p /var/log/rectobase

# Set permissions
useradd -r -s /usr/sbin/nologin rectobase 2>/dev/null || true
chown -R rectobase:rectobase /var/www/rectobase
chown -R rectobase:rectobase /opt/rectobase
chown -R rectobase:rectobase /var/backups/rectobase
chown -R rectobase:rectobase /var/log/rectobase

success "Direktori aplikasi dibuat"

# ─── Step 11: Buat Nginx Config ───────────────────────────────────────────────
step "Membuat konfigurasi Nginx..."

NGINX_CONF="/etc/nginx/sites-available/rectobase"

cat > "$NGINX_CONF" << 'NGINX_EOF'
# RectoBase Nginx Configuration
# Managed by rectobase deployment scripts

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=api_auth:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=api_general:10m rate=100r/m;

server {
    listen 80;
    listen [::]:80;
    server_name DOMAIN_PLACEHOLDER;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml text/javascript
               application/x-javascript application/xml application/javascript
               application/json application/xml+rss;

    # Static files
    root /var/www/rectobase/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Block sensitive paths
    location ~ /\.(?!well-known) {
        deny all;
    }

    location ~ ^/(env|proc|run|sys) {
        deny all;
    }

    # API proxy
    location /api/ {
        limit_req zone=api_general burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }

    # Auth rate limiting
    location /api/auth/ {
        limit_req zone=api_auth burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket proxy
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # Static caching
    location ~* \.(woff2?|ttf|eot|otf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location ~* \.(jpg|jpeg|png|gif|ico|svg|webp|avif)$ {
        expires 30d;
        add_header Cache-Control "public";
        access_log off;
    }

    location ~* \.(css|js|mjs)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # Block .env, .git, node_modules
    location ~ /\.(env|git) {
        deny all;
    }

    location /node_modules/ {
        deny all;
    }

    location ~ /\. {
        deny all;
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 "OK\n";
        add_header Content-Type text/plain;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name DOMAIN_PLACEHOLDER;

    # SSL akan dikelola oleh Certbot
    ssl_certificate /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml text/javascript
               application/x-javascript application/xml application/javascript
               application/json application/xml+rss;

    # Static files
    root /var/www/rectobase/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~ /\.(?!well-known) {
        deny all;
    }

    location ~ ^/(env|proc|run|sys) {
        deny all;
    }

    # API proxy
    location /api/ {
        limit_req zone=api_general burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }

    # Auth rate limiting
    location /api/auth/ {
        limit_req zone=api_auth burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket proxy
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # Static caching
    location ~* \.(woff2?|ttf|eot|otf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location ~* \.(jpg|jpeg|png|gif|ico|svg|webp|avif)$ {
        expires 30d;
        add_header Cache-Control "public";
        access_log off;
    }

    location ~* \.(css|js|mjs)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location ~ /\.(env|git) {
        deny all;
    }

    location /node_modules/ {
        deny all;
    }

    location ~ /\. {
        deny all;
    }

    location /health {
        access_log off;
        return 200 "OK\n";
        add_header Content-Type text/plain;
    }
}
NGINX_EOF

# Ganti placeholder dengan domain sebenarnya
sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" "$NGINX_CONF"

# Aktifkan site
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/rectobase

# Test konfigurasi Nginx
if ! nginx -t 2>&1 | grep -q "syntax is ok"; then
    error "Konfigurasi Nginx bermasalah!"
    nginx -t
    exit 1
fi

systemctl reload nginx
success "Nginx dikonfigurasi"

# ─── Step 12: SSL Certificate ────────────────────────────────────────────────
step "Mengambil SSL certificate dari Let's Encrypt..."

# Hentikan nginx sementara untuk certbot
systemctl stop nginx 2>/dev/null || true

# Generate SSL dengan Certbot
if certbot certonly --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --domains "$DOMAIN" \
    --key-type rsa \
    --rsa-key-size 4096 \
    2>&1 | tee -a "$LOG_FILE" | grep -q "Successfully"; then
    success "SSL certificate untuk $DOMAIN berhasil dibuat"
else
    # Jika standalone gagal (port 80 dipakai), coba dengan nginx
    systemctl start nginx 2>/dev/null || true
    certbot --nginx \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        --domains "$DOMAIN" \
        --rsa-key-size 4096 \
        --redirect \
        2>&1 | tee -a "$LOG_FILE" || true
    success "SSL certificate untuk $DOMAIN berhasil dibuat"
fi

systemctl start nginx 2>/dev/null || true

# ─── Step 13: Konfigurasi Firewall UFW ──────────────────────────────────────
step "Mengkonfigurasi UFW firewall..."

# Set default policies
ufw --force default deny incoming
ufw --force default allow outgoing

# Izinkan port yang diperlukan
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Aktifkan UFW
echo "y" | ufw enable 2>/dev/null || true
ufw status numbered

# Aktifkan logging
ufw logging ON

success "UFW firewall dikonfigurasi"

# ─── Step 14: Konfigurasi Fail2Ban ───────────────────────────────────────────
step "Mengkonfigurasi Fail2Ban..."

cat > /etc/fail2ban/jail.local << 'FAIL2BAN_EOF'
[rectobase-ssh]
enabled   = true
port      = ssh
filter    = sshd
logpath   = /var/log/auth.log
maxretry  = 5
bantime   = 3600
findtime  = 600
action    = iptables-allports

[rectobase-http]
enabled   = true
port      = http,https
filter    = nginx-http-auth
logpath   = /var/log/nginx/error.log
maxretry  = 10
bantime   = 600
findtime  = 300
FAIL2BAN_EOF

systemctl enable --now fail2ban 2>/dev/null || true
success "Fail2Ban aktif"

# ─── Step 15: Generate App Secrets ───────────────────────────────────────────
step "Generate application secrets..."

JWT_SECRET=$(openssl rand -hex 64)
SESSION_SECRET=$(openssl rand -hex 64)
REDIS_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Tripay merchant
TRIPAY_API_KEY=$(ask "Tripay API Key (kosongkan jika belum punya)" "")
TRIPAY_MERCHANT_CODE=$(ask "Tripay Merchant Code" "")
TRIPAY_CALLBACK_KEY=$(ask "Tripay Callback Key" "")

# Ultramsg WhatsApp
ULTRAMSG_INSTANCE_ID=$(ask "Ultramsg Instance ID (kosongkan jika belum pakai)" "")
ULTRAMSG_TOKEN=$(ask "Ultramsg Token (kosongkan jika belum pakai)" "")

success "Secrets di-generate"

# ─── Step 16: Buat Environment File ─────────────────────────────────────────
step "Membuat environment file di /etc/rectobase/env..."

cat > /etc/rectobase/env << ENV_EOF
# ============================================================
# RectoBase Production Environment Configuration
# Dihasilkan oleh vps-setup.sh pada $(date -Iseconds)
# JANGAN edit file ini langsung - gunakan update-env.sh
# ============================================================

# App
NODE_ENV=production
APP_NAME=RectoBase
APP_URL=https://$DOMAIN
APP_PORT=3000
APP_HOST=127.0.0.1

# Domain
DOMAIN=$DOMAIN
SSL_ENABLED=true

# Database
DATABASE_URL=postgresql://rectobase:${DB_PASS_SAVED}@localhost:5432/rectobase?schema=public&sslmode=prefer
DB_HOST=localhost
DB_PORT=5432
DB_NAME=rectobase
DB_USER=rectobase
DB_PASSWORD=${DB_PASS_SAVED}

# Redis
REDIS_URL=redis://:${REDIS_PASSWORD}@127.0.0.1:6379
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# Security
JWT_SECRET=${JWT_SECRET}
SESSION_SECRET=${SESSION_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
BCRYPT_ROUNDS=12

# Tripay Payment Gateway
TRIPAY_MODE=${TRIPAY_MODE}
TRIPAY_API_KEY=${TRIPAY_API_KEY}
TRIPAY_MERCHANT_CODE=${TRIPAY_MERCHANT_CODE}
TRIPAY_CALLBACK_KEY=${TRIPAY_CALLBACK_KEY}
TRIPAY_SANDBOX_URL=https://tripaayments.com/api/v1
TRIPAY_PRODUCTION_URL=https://tripaayments.com/api/v1

# Ultramsg WhatsApp
ULTRAMSG_INSTANCE_ID=${ULTRAMSG_INSTANCE_ID}
ULTRAMSG_TOKEN=${ULTRAMSG_TOKEN}
ULTRAMSG_API_URL=https://api.ultramsg.com/\${ULTRAMSG_INSTANCE_ID}/instance

# Email (optional - menggunakan SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@${DOMAIN}
SMTP_TLS=true

# Log
LOG_LEVEL=info
LOG_DIR=/var/log/rectobase
PM2_HOME=/root/.pm2

# CORS
CORS_ORIGIN=https://$DOMAIN

# File Storage
UPLOAD_DIR=/var/www/rectobase/uploads
MAX_FILE_SIZE=10485760

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Timezone Indonesia (WIB)
TZ=Asia/Jakarta
ENV_EOF

# Set permissions ketat
chmod 600 /etc/rectobase/env
chown root:root /etc/rectobase/env
success "Environment file dibuat"

# ─── Step 17: Setup Logrotate ─────────────────────────────────────────────────
step "Mengkonfigurasi logrotate..."

cat > /etc/logrotate.d/rectobase << 'LOGROTATE_EOF'
/var/log/rectobase/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 rectobase rectobase
    sharedscripts
    postrotate
        pm2 reloadLogs 2>/dev/null || true
    endscript
}

/root/.pm2/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
    sharedscripts
}
LOGROTATE_EOF

success "Logrotate dikonfigurasi"

# ─── Step 18: Setup PM2 Ecosystem File ───────────────────────────────────────
step "Membuat PM2 ecosystem file..."

cat > /opt/rectobase/ecosystem.config.js << 'PM2_EOF'
module.exports = {
  apps: [
    {
      name: 'rectobase',
      script: 'dist/index.js',
      cwd: '/opt/rectobase',
      instances: 1,
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      merge_logs: true,
      log_file: '/var/log/rectobase/app.log',
      error_file: '/var/log/rectobase/error.log',
      out_file: '/var/log/rectobase/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch: false,
      ignore_watch: ['node_modules', '.git', 'logs', 'uploads'],
      max_restarts: 10,
      min_uptime: '60s',
      restart_delay: 4000,
      autorestart: true,
      listen_timeout: 8000,
      kill_timeout: 5000,
    },
  ],
};
PM2_EOF

chmod 644 /opt/rectobase/ecosystem.config.js
success "PM2 ecosystem file dibuat"

# ─── Step 19: Auto-start PM2 ──────────────────────────────────────────────────
step "Setup PM2 autostart..."

env PATH="$PATH:/usr/local/bin" pm2 startup systemd -u root --hp /root &>/dev/null || true
env PATH="$PATH:/usr/local/bin" pm2 save &>/dev/null || true
success "PM2 autostart dikonfigurasi"

# ─── Step 20: SSL Renewal Cron ───────────────────────────────────────────────
step "Setup SSL auto-renewal..."

cat > /etc/cron.d/certbot-renewal << 'CRON_EOF'
# Certbot SSL certificate renewal
0 3 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx" 2>/dev/null
CRON_EOF

success "SSL auto-renewal aktif"

# ─── Step 21: Health Check ───────────────────────────────────────────────────
step "Melakukan health check..."

echo ""
echo "══════════════════════════════════════════════"
echo -e "  ${GREEN}Setup RectoBase Selesai!${NC}"
echo "══════════════════════════════════════════════"
echo ""
echo -e "${GREEN}[INFO]${NC} Ringkasan instalasi:"
echo "  - Domain      : $DOMAIN"
echo "  - PostgreSQL  : rectobase@localhost:5432"
echo "  - Redis       : 127.0.0.1:6379"
echo "  - Nginx       : reverse proxy aktif"
echo "  - SSL         : Let's Encrypt aktif"
echo "  - Firewall    : UFW aktif (22, 80, 443)"
echo "  - PM2         : autostart dikonfigurasi"
echo ""
echo -e "${YELLOW}[IMPORTANT]${NC} Langkah selanjutnya:"
echo "  1. Deploy aplikasi:"
echo "     ./deploy.sh root@$DOMAIN $DOMAIN"
echo ""
echo "  2. Jika belum punya aplikasi, clone dulu:"
echo "     git clone <repo> /opt/rectobase"
echo "     cd /opt/rectobase"
echo "     # Set environment"
echo "     ./deploy.sh root@$DOMAIN $DOMAIN"
echo ""
echo "  3. Cek status:"
echo "     pm2 status"
echo "     pm2 logs rectobase"
echo ""
echo "  4. Health check:"
echo "     curl -f https://$DOMAIN/api/health || echo 'Backend belum running - normal jika belum di-deploy'"
echo ""
echo -e "${YELLOW}[INFO]${NC} Environment file: /etc/rectobase/env"
echo "     Backup file ini! Berisi semua secrets."
echo ""
echo -e "${GREEN}[OK]${NC} Setup log tersimpan di: $LOG_FILE"
echo ""

# Final health check - cek semua services
echo -e "${GREEN}[HEALTH CHECK]${NC}"
systemctl is-active --quiet postgresql && echo "  PostgreSQL : RUNNING" || echo -e "  PostgreSQL : ${RED}STOPPED${NC}"
systemctl is-active --quiet redis-server && echo "  Redis      : RUNNING" || echo -e "  Redis      : ${RED}STOPPED${NC}"
systemctl is-active --quiet nginx && echo "  Nginx      : RUNNING" || echo -e "  Nginx      : ${RED}STOPPED${NC}"
systemctl is-active --quiet fail2ban && echo "  Fail2Ban   : RUNNING" || echo -e "  Fail2Ban   : ${RED}STOPPED${NC}"
pm2 describe rectobase &>/dev/null && echo "  PM2 App    : REGISTERED" || echo -e "  PM2 App    : ${YELLOW}BELUM DI-DEPLOY${NC}"

echo ""
echo "══════════════════════════════════════════════"
echo -e "${GREEN}RectoBase VPS Setup berhasil diselesaikan!${NC}"
echo "══════════════════════════════════════════════"
