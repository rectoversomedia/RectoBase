#!/bin/bash
# =============================================================================
# RectoBase Monitoring Setup Script
# Setup monitoring: Uptime Kuma, health checks, logrotate, UFW logging
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
readonly DOMAIN="${DOMAIN:-}"
readonly TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
readonly TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
readonly DISCORD_WEBHOOK="${DISCORD_WEBHOOK:-}"
readonly LOG_DIR="/var/log/rectobase"
readonly MONITOR_DIR="/opt/monitoring"
readonly CRON_LOG_FILE="$LOG_DIR/health-check.log"

# ─── Helper Functions ───────────────────────────────────────────────────────
log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

step() {
    echo -e "${GREEN}[STEP]${NC} $1"
    log "[STEP] $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
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

# ─── Banner ─────────────────────────────────────────────────────────────────
banner() {
    cat << 'BANNER'
╔═══════════════════════════════════════════════════════════╗
║         RectoBase Monitoring Setup                         ║
║         Health Checks + Uptime Monitoring                 ║
╚═══════════════════════════════════════════════════════════╝
BANNER
    echo ""
}

# ─── Step 1: UFW Logging ────────────────────────────────────────────────────
setup_ufw_logging() {
    step "Mengaktifkan UFW logging..."

    # Cek apakah UFW aktif
    if systemctl is-active --quiet ufw; then
        # Set log level
        ufw logging ON

        # Set log level ke medium (capture blocked, invalid, new connections)
        if grep -q "LOG_LEVEL" /etc/ufw/ufw.conf 2>/dev/null; then
            sed -i 's/LOG_LEVEL=.*/LOG_LEVEL=medium/' /etc/ufw/ufw.conf
        else
            echo "LOG_LEVEL=medium" >> /etc/ufw/ufw.conf
        fi

        # Rotate UFW logs
        if [[ ! -f /etc/logrotate.d/ufw ]]; then
            cat > /etc/logrotate.d/ufw << 'UFW_LOGROTATE'
/var/log/ufw.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root adm
    sharedscripts
    postrotate
        [ -s /run/ufw/ufw.log ] && touch /run/ufw/ufw.log
        [ -x /usr/lib/ufw/ufw-init ] && /usr/lib/ufw/ufw-init restart >/dev/null 2>&1 || true
    endscript
}
UFW_LOGROTATE
        fi

        success "UFW logging diaktifkan"
    else
        warn "UFW tidak aktif. Aktifkan manual: ufw enable"
    fi
}

# ─── Step 2: Logrotate Configuration ─────────────────────────────────────────
setup_logrotate() {
    step "Mengkonfigurasi logrotate..."

    mkdir -p "$LOG_DIR"
    chown -R rectobase:rectobase "$LOG_DIR" 2>/dev/null || true

    # App logs
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
        pm2 reloadLogs >/dev/null 2>&1 || true
    endscript
}
LOGROTATE_EOF

    # PM2 logs
    cat > /etc/logrotate.d/pm2 << 'PM2_LOGROTATE'
/root/.pm2/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
    postrotate
        pm2 reloadLogs >/dev/null 2>&1 || true
    endscript
}
PM2_LOGROTATE

    # Nginx logs
    cat > /etc/logrotate.d/nginx-rectobase << 'NGINX_LOGROTATE'
/var/log/nginx/rectobase-*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -s /run/nginx.pid ] && kill -USR1 `cat /run/nginx.pid` 2>/dev/null || true
    endscript
}
NGINX_LOGROTATE

    success "Logrotate dikonfigurasi"
}

# ─── Step 3: Health Check Cron ───────────────────────────────────────────────
setup_health_check_cron() {
    step "Setup health check cron job..."

    # Buat health check script
    cat > /opt/rectobase/health-check.sh << 'HEALTH_EOF'
#!/bin/bash
# RectoBase Health Check Script
# Dijalankan via cron setiap 5 menit

set -euo pipefail

DOMAIN="${DOMAIN:-localhost}"
LOG_FILE="/var/log/rectobase/health-check.log"
ALERT_THRESHOLD=3
STATE_FILE="/var/run/rectobase-health.state"

# Warna
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Load env
if [[ -f /etc/rectobase/env ]]; then
    export $(grep -v '^#' /etc/rectobase/env | xargs)
fi

DOMAIN="${APP_URL:-https://$DOMAIN}"

# Check API health
check_health() {
    local url="${DOMAIN}/api/health"
    local status_code
    status_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$url" 2>/dev/null || echo "000")
    echo "$status_code"
}

# Send alert via Telegram
send_telegram() {
    local message="$1"
    local token="${TELEGRAM_BOT_TOKEN:-}"
    local chat_id="${TELEGRAM_CHAT_ID:-}"

    if [[ -z "$token" || -z "$chat_id" ]]; then
        return 0
    fi

    curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" \
        -d "chat_id=${chat_id}" \
        -d "text=${message}" \
        -d "parse_mode=HTML" >/dev/null 2>&1 || true
}

# Send alert via Discord
send_discord() {
    local message="$1"
    local webhook="${DISCORD_WEBHOOK_URL:-}"

    if [[ -z "$webhook" ]]; then
        return 0
    fi

    curl -s -X POST "$webhook" \
        -H "Content-Type: application/json" \
        -d "{\"content\": \"${message}\"}" >/dev/null 2>&1 || true
}

# Main health check
status_code=$(check_health)
timestamp=$(date '+%Y-%m-%d %H:%M:%S')

if [[ "$status_code" == "200" ]]; then
    echo -e "${GREEN}[OK]${NC} Health check OK (HTTP $status_code)"

    # Reset failure counter
    echo "0" > "$STATE_FILE"

    log "Health check OK - HTTP $status_code"
else
    echo -e "${RED}[FAIL]${NC} Health check FAILED (HTTP $status_code)"
    log "Health check FAILED - HTTP $status_code"

    # Increment failure counter
    failures=$(($(cat "$STATE_FILE" 2>/dev/null || echo 0) + 1))
    echo "$failures" > "$STATE_FILE"

    # Alert on threshold
    if [[ $failures -ge $ALERT_THRESHOLD ]]; then
        local alert_msg="⚠️ <b>RectoBase Health Check Failed</b>%0A%0A"
        alert_msg="${alert_msg}URL: ${DOMAIN}%0A"
        alert_msg="${alert_msg}Status: HTTP $status_code%0A"
        alert_msg="${alert_msg}Failures: $failures consecutive%0A"
        alert_msg="${alert_msg}Time: $timestamp"

        send_telegram "$alert_msg"
        send_discord "⚠️ **RectoBase Health Check Failed**%0AURL: $DOMAIN%0AStatus: HTTP $status_code%0AFailures: $failures consecutive"

        log "Alert sent - $failures consecutive failures"
    fi
fi
HEALTH_EOF

    chmod +x /opt/rectobase/health-check.sh
    chown root:root /opt/rectobase/health-check.sh

    # Setup cron - setiap 5 menit
    local cron_entry="*/5 * * * * root /opt/rectobase/health-check.sh >> $CRON_LOG_FILE 2>&1"

    # Hapus cron lama jika ada
    grep -v "rectobase/health-check" /etc/crontab > /tmp/crontab.tmp 2>/dev/null || true
    echo "$cron_entry" >> /tmp/crontab.tmp
    mv /tmp/crontab.tmp /etc/crontab

    # Buat log file
    touch "$CRON_LOG_FILE"
    chmod 644 "$CRON_LOG_FILE"

    success "Health check cron diaktifkan (setiap 5 menit)"
}

# ─── Step 4: System Monitoring ──────────────────────────────────────────────
setup_system_monitoring() {
    step "Setup system monitoring..."

    # Load average monitoring
    cat > /opt/rectobase/system-monitor.sh << 'SYS_MON_EOF'
#!/bin/bash
# RectoBase System Monitor
# Cek RAM, Disk, CPU usage

LOG_FILE="/var/log/rectobase/system-monitor.log"
STATE_FILE="/var/run/rectobase-system.state"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Thresholds
RAM_THRESHOLD=85
DISK_THRESHOLD=85
CPU_THRESHOLD=80

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

alert=false
message=""

# Check RAM
ram_usage=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
if [[ $ram_usage -ge $RAM_THRESHOLD ]]; then
    echo -e "${RED}[WARN]${NC} RAM usage HIGH: ${ram_usage}%"
    message="${message}RAM: ${ram_usage}% "
    alert=true
fi

# Check Disk
disk_usage=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [[ $disk_usage -ge $DISK_THRESHOLD ]]; then
    echo -e "${RED}[WARN]${NC} Disk usage HIGH: ${disk_usage}%"
    message="${message}Disk: ${disk_usage}% "
    alert=true
fi

# Check Load Average
load=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | tr -d ',')
cpus=$(nproc)
load_pct=$(echo "scale=0; $load / $cpus * 100" | bc 2>/dev/null || echo 0)
if [[ $load_pct -ge $CPU_THRESHOLD ]]; then
    echo -e "${YELLOW}[WARN]${NC} Load average HIGH: $load (${load_pct}%)"
    message="${message}Load: ${load} "
fi

# Log
if [[ "$alert" == "true" ]]; then
    log "ALERT: $message"
    # Send alert via PM2 (optional)
    if [[ -f /etc/rectobase/env ]]; then
        source /etc/rectobase/env
    fi
else
    echo -e "${GREEN}[OK]${NC} System resources normal"
    log "System OK - RAM: ${ram_usage}%, Disk: ${disk_usage}%"
fi
SYS_MON_EOF

    chmod +x /opt/rectobase/system-monitor.sh

    # Cron: setiap 15 menit
    local cron_entry="*/15 * * * * root /opt/rectobase/system-monitor.sh >> $LOG_DIR/system-monitor.log 2>&1"
    grep -v "system-monitor" /etc/crontab > /tmp/crontab.tmp 2>/dev/null || true
    echo "$cron_entry" >> /tmp/crontab.tmp
    mv /tmp/crontab.tmp /etc/crontab

    success "System monitoring aktif"
}

# ─── Step 5: PM2 Monitoring ──────────────────────────────────────────────────
setup_pm2_monitoring() {
    step "Setup PM2 monitoring..."

    # Install pm2-alive untuk auto-restart
    if command -v pm2 &>/dev/null; then
        # Monitor every minute
        if ! crontab -l 2>/dev/null | grep -q "pm2 describe"; then
            (crontab -l 2>/dev/null; echo "*/1 * * * * pm2 describe rectobase >/dev/null 2>&1 || (pm2 restart rectobase && pm2 save)") | crontab -
        fi

        # Enable PM2 monit daemon
        pm2 set pm2:autodump true 2>/dev/null || true
        pm2 set pm2:http_behaviour false 2>/dev/null || true

        success "PM2 monitoring aktif"
    else
        warn "PM2 tidak terinstall - skip PM2 monitoring"
    fi
}

# ─── Step 6: Uptime Kuma (Docker) ─────────────────────────────────────────────
setup_uptime_kuma() {
    step "Setup Uptime Kuma (Docker)..."

    # Cek apakah Docker tersedia
    if ! command -v docker &>/dev/null; then
        warn "Docker tidak tersedia - skip Uptime Kuma"
        info "Untuk install Uptime Kuma manual:"
        info "  1. Install Docker: curl -fsSL https://get.docker.com | sh"
        info "  2. docker volume create uptime-kuma"
        info "  3. docker run -d --restart=always -p 3001:3001 -v uptime-kuma:/app/node_modules louislam/uptime-kuma"
        info "  4. Akses di http://your-server:3001"
        return 0
    fi

    # Cek apakah Uptime Kuma sudah berjalan
    if docker ps | grep -q uptime-kuma; then
        warn "Uptime Kuma sudah berjalan"
        return 0
    fi

    mkdir -p "$MONITOR_DIR"

    # Buat docker-compose.yml
    cat > "$MONITOR_DIR/docker-compose.yml" << 'UPTIME_EOF'
version: '3.8'

services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: uptime-kuma
    restart: always
    ports:
      - "3001:3001"
    volumes:
      - uptime-kuma-data:/app/node_modules
    environment:
      - UPTIME_KUMA_PORT=3001

volumes:
  uptime-kuma-data:
UPTIME_EOF

    # Start Uptime Kuma
    cd "$MONITOR_DIR"
    docker-compose up -d

    # Firewall: allow port 3001
    ufw allow 3001/tcp comment 'Uptime Kuma' 2>/dev/null || true

    success "Uptime Kuma aktif di http://$(curl -s ifconfig.me 2>/dev/null || hostname):3001"
    info "Setup monitor untuk:"
    info "  - https://${DOMAIN:-your-domain.com}/api/health"
    info "  - https://${DOMAIN:-your-domain.com}/"
}

# ─── Step 7: Fail2Ban Configuration ─────────────────────────────────────────
setup_fail2ban() {
    step "Setup Fail2Ban monitoring..."

    if ! command -v fail2ban-client &>/dev/null; then
        warn "Fail2Ban tidak tersedia"
        return 0
    fi

    # Tambah jail untuk RectoBase
    cat > /etc/fail2ban/jail.d/rectobase.local << 'FAIL2BAN_EOF'
[rectobase-ssh]
enabled   = true
port      = ssh
filter    = sshd
logpath   = /var/log/auth.log
maxretry  = 5
bantime   = 3600
findtime  = 600
action    = iptables-allports[name=ssh]

[rectobase-nginx-http-auth]
enabled   = true
port      = http,https
filter    = nginx-http-auth
logpath   = /var/log/nginx/rectobase-error.log
maxretry  = 5
bantime   = 3600
findtime  = 600

[rectobase-nginx-noscript]
enabled   = true
port      = http,https
filter    = nginx-noscript
logpath   = /var/log/nginx/rectobase-access.log
maxretry  = 10
bantime   = 600
findtime  = 300

[rectobase-nginx-badbots]
enabled   = true
port      = http,https
filter    = nginx-badbots
logpath   = /var/log/nginx/rectobase-access.log
maxretry  = 3
bantime   = 86400
findtime  = 3600
FAIL2BAN_EOF

    systemctl restart fail2ban 2>/dev/null || true
    success "Fail2Ban configured untuk RectoBase"
}

# ─── Step 8: Logwatch (Optional) ─────────────────────────────────────────────
setup_logwatch() {
    step "Setup log monitoring..."

    # Install logwatch jika belum ada
    if ! command -v logwatch &>/dev/null; then
        apt-get install -y logwatch &>/dev/null 2>&1 || true
    fi

    # Daily log summary via email
    cat > /etc/cron.daily/00rectobase-logwatch << 'LOGWATCH_EOF'
#!/bin/bash
# RectoBase Daily Log Summary

RECIPIENT="${BACKUP_EMAIL:-root}"

# Nginx errors summary
if [[ -f /var/log/nginx/rectobase-error.log ]]; then
    ERROR_COUNT=$(grep -c "error\|Error\|ERROR" /var/log/nginx/rectobase-error.log 2>/dev/null || echo 0)
    if [[ $ERROR_COUNT -gt 10 ]]; then
        echo "Nginx error count: $ERROR_COUNT" | mail -s "[RectoBase] Nginx Errors: $ERROR_COUNT" "$RECIPIENT"
    fi
fi
LOGWATCH_EOF

    chmod +x /etc/cron.daily/00rectobase-logwatch
    success "Log monitoring aktif"
}

# ─── Step 9: Dashboard Summary ──────────────────────────────────────────────
show_summary() {
    echo ""
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║         Monitoring Setup Complete!                      ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""

    echo -e "  ${GREEN}Aktif:${NC}"
    echo "    - Health check cron: setiap 5 menit"
    echo "    - System monitoring: setiap 15 menit"
    echo "    - UFW logging: aktif"
    echo "    - Logrotate: 14 hari retention"
    echo "    - PM2 auto-restart: aktif"
    echo ""

    if command -v docker &>/dev/null && docker ps | grep -q uptime-kuma; then
        echo -e "  ${GREEN}Uptime Kuma:${NC}"
        echo "    - URL: http://$(curl -s ifconfig.me 2>/dev/null || hostname):3001"
        echo "    - Setup monitor untuk RectoBase API"
        echo ""
    fi

    echo -e "  ${GREEN}Log Files:${NC}"
    echo "    - Health check : $CRON_LOG_FILE"
    echo "    - System monitor: $LOG_DIR/system-monitor.log"
    echo "    - PM2 logs     : pm2 logs rectobase"
    echo ""

    echo -e "  ${GREEN}Monitoring Commands:${NC}"
    echo "    pm2 status              - Cek status aplikasi"
    echo "    pm2 monit               - Monitor real-time"
    echo "    pm2 logs rectobase      - Lihat logs"
    echo "    tail -f $CRON_LOG_FILE  - Lihat health check"
    echo "    ufw status              - Cek firewall"
    echo "    fail2ban-client status  - Cek banned IPs"
    echo ""

    echo -e "  ${GREEN}Alert Channels:${NC}"
    [[ -n "$TELEGRAM_BOT_TOKEN" ]] && echo "    - Telegram: configured" || echo "    - Telegram: not configured"
    [[ -n "$DISCORD_WEBHOOK" ]] && echo "    - Discord: configured" || echo "    - Discord: not configured"
    echo ""
}

# ─── Main ───────────────────────────────────────────────────────────────────
main() {
    check_root
    banner

    step "Memulai setup monitoring..."

    # Parse domain dari args jika ada
    for arg in "$@"; do
        if [[ "$arg" =~ --domain= ]]; then
            DOMAIN="${arg#*=}"
        fi
    done

    setup_ufw_logging
    setup_logrotate
    setup_health_check_cron
    setup_system_monitoring
    setup_pm2_monitoring
    setup_fail2ban
    setup_logwatch

    # Uptime Kuma optional
    read -p "Setup Uptime Kuma (Docker-based monitoring)? [y/N]: " setup_kuma
    if [[ "$setup_kuma" =~ ^[Yy]$ ]]; then
        setup_uptime_kuma
    fi

    show_summary
}

main "$@"
