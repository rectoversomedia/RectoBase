# RectoBase Deployment Guide

Dokumentasi lengkap untuk deployment RectoBase ke VPS production. RectoBase adalah sistem POS + CRM SaaS untuk UMKM Indonesia.

---

## Daftar Isi

1. [Persyaratan](#persyaratan)
2. [Arsitektur](#arsitektur)
3. [Setup VPS](#setup-vps)
4. [Deployment](#deployment)
5. [Konfigurasi Environment](#konfigurasi-environment)
6. [Setup Payment Gateway Tripay](#setup-payment-gateway-tripay)
7. [Setup WhatsApp (Ultramsg)](#setup-whatsapp-ultramsg)
8. [Maintenance](#maintenance)
9. [Troubleshooting](#troubleshooting)
10. [Referensi Environment Variables](#referensi-environment-variables)

---

## Persyaratan

### Spesifikasi VPS Minimum

| Komponen | Minimum | Disarankan |
|----------|---------|------------|
| RAM | 2 GB | 4 GB |
| CPU | 1 Core | 2+ Cores |
| Disk | 20 GB | 40+ GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| Arch | x86_64 | x86_64 |

### Software Requirements

- Ubuntu 22.04 LTS atau 24.04 LTS
- Akses root atau sudo
- Domain yang sudah pointing ke VPS IP
- Port terbuka: 22 (SSH), 80 (HTTP), 443 (HTTPS)

---

## Arsitektur

```
                                    ┌─────────────────┐
  Client Browser ────────── HTTPS ──│     Nginx       │
                                    │  (Reverse Proxy)│
                                    │  Port 443/80    │
                                    └────────┬────────┘
                                             │
                            ┌────────────────┼────────────────┐
                            │                │                │
                            ▼                ▼                ▼
                    ┌───────────┐   ┌───────────┐   ┌───────────┐
                    │  Frontend  │   │  Backend   │   │  Static   │
                    │  (SPA)     │   │  (Node.js) │   │  Files    │
                    │  Port 3000 │   │  Port 3000 │   │           │
                    └───────────┘   └─────┬───────┘   └───────────┘
                                          │
                            ┌─────────────┴─────────────┐
                            │                           │
                            ▼                           ▼
                    ┌───────────────┐           ┌───────────────┐
                    │  PostgreSQL   │           │    Redis      │
                    │   Port 5432   │           │   Port 6379   │
                    └───────────────┘           └───────────────┘
```

---

## Setup VPS

### Langkah 1: SSH ke VPS

```bash
ssh root@IP_VPS_ANDA
```

### Langkah 2: Install RectoBase Deployment Scripts

```bash
# Buat direktori deployment
mkdir -p /opt/rectobase/deployment

# Copy semua file deployment dari repository
# Atau download langsung
git clone https://github.com/rectobase/deployment.git /opt/rectobase/deployment

# Set executable
chmod +x /opt/rectobase/deployment/*.sh
```

### Langkah 3: Jalankan VPS Setup

```bash
cd /opt/rectobase/deployment

# Jalankan dengan domain dan email
./vps-setup.sh \
    --domain=pos.toko-saya.com \
    --email=admin@toko-saya.com

# Dengan mode Tripay production
./vps-setup.sh \
    --domain=pos.toko-saya.com \
    --email=admin@toko-saya.com \
    --tripay-mode=production
```

### Apa yang dilakukan script:

1. Update sistem (apt-get update & upgrade)
2. Install Node.js 20 LTS
3. Install PostgreSQL 16
4. Install dan konfigurasi Redis
5. Install PM2 (process manager)
6. Install Nginx
7. Install Certbot (SSL)
8. Setup firewall UFW
9. Setup Fail2Ban
10. Generate secrets dan SSL certificate
11. Membuat environment file di `/etc/rectobase/env`

### Langkah 4: Verifikasi Setup

```bash
# Cek status semua service
systemctl status postgresql
systemctl status redis-server
systemctl status nginx
systemctl status fail2ban

# Cek firewall
ufw status

# Cek PM2
pm2 status
```

---

## Deployment

### Dari Mesin Lokal

Script `deploy.sh` melakukan deployment dari mesin lokal ke VPS menggunakan rsync.

**Prasyarat di mesin lokal:**

```bash
# Install dependencies
npm install -g rsync ssh

# Pastikan bisa SSH tanpa password (SSH key)
ssh-copy-id root@IP_VPS_ANDA
```

**Jalankan deployment:**

```bash
cd /path/ke/rectobase

# Deploy ke production
./deploy.sh root@192.168.1.100 pos.toko-saya.com

# Deploy dengan branch tertentu
./deploy.sh root@192.168.1.100 pos.toko-saya.com staging
```

### Dari VPS (Git Pull)

Jika deployment menggunakan git:

```bash
cd /opt/rectobase

# Pull dari git
git pull origin main

# Install dependencies
npm ci --production

# Jalankan migrations
npm run migrate

# Restart PM2
pm2 restart rectobase
```

### Alur Deployment

1. **Pre-deployment**: Backup state sebelumnya ke `/var/backups/rectobase/pre-deploy/`
2. **Rsync**: Sinkronisasi file dari lokal ke VPS
3. **Install**: `npm ci --production` di VPS
4. **Migrate**: Jalankan database migrations
5. **Restart**: PM2 restart aplikasi
6. **Health Check**: Verifikasi aplikasi running

---

## Konfigurasi Environment

File environment tersimpan di `/etc/rectobase/env` (chmod 600).

### Variabel Penting

```bash
# Database
DATABASE_URL=postgresql://rectobase:PASSWORD@localhost:5432/rectobase

# Redis
REDIS_URL=redis://:PASSWORD@127.0.0.1:6379

# App
APP_URL=https://pos.toko-saya.com
NODE_ENV=production

# Tripay Payment Gateway
TRIPAY_MODE=sandbox|production
TRIPAY_API_KEY=your-api-key
TRIPAY_MERCHANT_CODE=your-merchant-code
TRIPAY_CALLBACK_KEY=your-callback-key
```

### Update Environment

```bash
# Edit environment file
nano /etc/rectobase/env

# Restart aplikasi untuk apply perubahan
pm2 restart rectobase
```

---

## Setup Payment Gateway Tripay

Tripay adalah payment gateway Indonesia yang mendukung berbagai metode pembayaran (VA, e-wallet, dll).

### Langkah 1: Registrasi Tripay

1. Kunjungi https://tripay.co.id
2. Registrasi merchant baru
3. Lengkapi dokumen verifikasi (KTP, NPWP bisnis)
4. Tunggu approval (1-2 hari kerja)

### Langkah 2: Dapatkan API Credentials

Setelah approved, buka Dashboard Merchant:

1. **API Key**: Menu Settings > API Key
2. **Merchant Code**: Terlihat di dashboard atas
3. **Private Key**: Menu Settings > API Key > Private Key

### Langkah 3: Setup Callback URL

Di dashboard Tripay:

1. Menu Settings > Payment Callback
2. Set URL: `https://pos.toko-saya.com/api/payment/tripay/callback`
3. Callback method: POST
4. Signature: SHA256

### Langkah 4: Konfigurasi di RectoBase

```bash
nano /etc/rectobase/env

# Set Tripay credentials
TRIPAY_MODE=production
TRIPAY_API_KEY=your-api-key-from-tripay
TRIPAY_MERCHANT_CODE=TXXXXXX
TRIPAY_CALLBACK_KEY=your-private-key
```

### Tripay Sandbox (Development)

```bash
# Mode sandbox untuk testing
TRIPAY_MODE=sandbox
TRIPAY_API_KEY=sandbox-api-key
TRIPAY_MERCHANT_CODE=sandbox-merchant
```

### Test Payment Flow

1. Buat transaksi test
2. Cek callback URL dipanggil
3. Verifikasi di dashboard Tripay
4. Cek log di RectoBase: `pm2 logs rectobase`

---

## Setup WhatsApp (Ultramsg)

Ultramsg menyediakan API untuk mengirim pesan WhatsApp Business.

### Langkah 1: Registrasi Ultramsg

1. Kunjungi https://ultramsg.com
2. Registrasi akun baru
3. Pilih plan (free tier tersedia)

### Langkah 2: Setup Instance

1. Login ke dashboard Ultramsg
2. Buat instance baru
3. Pilih "WhatsApp Business" type
4. Scan QR code untuk connect WhatsApp number

### Langkah 3: Dapatkan Credentials

Di dashboard Ultramsg:

1. **Instance ID**: Settings > Instance ID
2. **Token**: Settings > API Token

### Langkah 4: Konfigurasi di RectoBase

```bash
nano /etc/rectobase/env

# Set Ultramsg credentials
ULTRAMSG_INSTANCE_ID=instance12345
ULTRAMSG_TOKEN=your-token-here
```

### Penggunaan

WhatsApp notification digunakan untuk:

- **Notifikasi pesanan baru**: Kirim ke customer dan admin
- **Reminder pembayaran**: Pesan pengingat ke customer
- **Status pesanan**: Update ke customer
- **Laporan harian**: Kirim ringkasan ke admin

### Test WhatsApp API

```bash
# Test kirim pesan
curl -X POST "https://api.ultramsg.com/instance12345/messages/chat" \
  -d "token=your-token" \
  -d "to=6281234567890" \
  -d "body=Test message from RectoBase"
```

---

## Maintenance

### PM2 Commands

```bash
# Cek status aplikasi
pm2 status

# Lihat logs real-time
pm2 logs rectobase

# Restart aplikasi
pm2 restart rectobase

# Stop aplikasi
pm2 stop rectobase

# Delete dan cleanup
pm2 delete rectobase

# Monitor real-time (CPU/RAM)
pm2 monit

# Reload logs (setelah logrotate)
pm2 reloadLogs
```

### Backup

```bash
# Manual backup
/opt/rectobase/deployment/backup.sh run

# List backups
/opt/rectobase/deployment/backup.sh list

# Restore dari backup
/opt/rectobase/deployment/backup.sh restore /var/backups/rectobase/rectobase-backup-20240801-120000.sql.gz
```

### Rollback

```bash
# Rollback interaktif (pilih backup)
/opt/rectobase/deployment/rollback.sh interactive

# Quick rollback ke backup terakhir
/opt/rectobase/deployment/rollback.sh quick

# Lihat history
/opt/rectobase/deployment/rollback.sh history
```

### Database Migrations

```bash
# Jalankan pending migrations
/opt/rectobase/deployment/migrate.sh run

# List migrations
/opt/rectobase/deployment/migrate.sh list

# Rollback 1 migration terakhir
/opt/rectobase/deployment/migrate.sh rollback 1
```

### Log Files

```bash
# Application logs
pm2 logs rectobase
cat /var/log/rectobase/app.log

# Nginx access log
tail -f /var/log/nginx/rectobase-access.log

# Nginx error log
tail -f /var/log/nginx/rectobase-error.log

# Health check log
tail -f /var/log/rectobase/health-check.log
```

### SSL Renewal

SSL dari Let's Encrypt otomatis di-renew via cron. Manual:

```bash
# Test renewal
certbot renew --dry-run

# Force renewal
certbot renew --force-renewal
```

### Update Sistem

```bash
# Update packages
apt-get update && apt-get upgrade -y

# Update Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Update PM2
npm install -g pm2
pm2 update
```

---

## Troubleshooting

### Aplikasi Tidak Running

```bash
# Cek PM2 status
pm2 status

# Lihat error logs
pm2 logs rectobase --err --lines 50

# Cek apakah port 3000 listening
ss -tlnp | grep 3000

# Restart manual
pm2 restart rectobase
```

### Database Connection Error

```bash
# Cek PostgreSQL status
systemctl status postgresql

# Cek apakah bisa konek
PGPASSWORD=PASSWORD psql -h localhost -U rectobase -d rectobase -c "SELECT 1"

# Restart PostgreSQL
systemctl restart postgresql
```

### Nginx Error

```bash
# Test konfigurasi
nginx -t

# Cek error log
tail -f /var/log/nginx/rectobase-error.log

# Reload Nginx
systemctl reload nginx
```

### SSL Certificate Error

```bash
# Cek certificate
certbot certificates

# Renew manual
certbot renew

# Reload Nginx
systemctl reload nginx
```

### High Memory Usage

```bash
# Cek memory usage per process
pm2 top

# Cek system memory
free -h

# PM2 restart jika over limit
pm2 restart rectobase
```

### Disk Space Penuh

```bash
# Cek penggunaan disk
df -h

# Hapus old backups
/opt/rectobase/deployment/backup.sh

# Clean PM2 logs
pm2 flush

# Clean apt cache
apt-get clean
```

### Firewall Issues

```bash
# Cek UFW status
ufw status

# Allow port
ufw allow 22/tcp

# Lihat UFW logs
tail -f /var/log/ufw.log
```

### Cron Jobs Tidak Jalan

```bash
# Cek cron service
systemctl status cron

# Lihat cron log
grep CRON /var/log/syslog | tail -20

# Test cron manually
/opt/rectobase/health-check.sh
```

---

## Referensi Environment Variables

### Aplikasi

| Variable | Deskripsi | Contoh |
|----------|-----------|--------|
| `NODE_ENV` | Environment | `production` |
| `APP_NAME` | Nama aplikasi | `RectoBase` |
| `APP_URL` | URL aplikasi | `https://pos.toko-saya.com` |
| `APP_PORT` | Port backend | `3000` |
| `DOMAIN` | Domain | `pos.toko-saya.com` |

### Database

| Variable | Deskripsi | Contoh |
|----------|-----------|--------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_NAME` | Database name | `rectobase` |
| `DB_USER` | Database user | `rectobase` |
| `DB_PASSWORD` | Database password | `secret` |

### Redis

| Variable | Deskripsi | Contoh |
|----------|-----------|--------|
| `REDIS_URL` | Redis connection string | `redis://:pass@host:6379` |
| `REDIS_PASSWORD` | Redis password | `secret` |
| `REDIS_HOST` | Redis host | `127.0.0.1` |
| `REDIS_PORT` | Redis port | `6379` |

### Security

| Variable | Deskripsi | Contoh |
|----------|-----------|--------|
| `JWT_SECRET` | JWT signing secret (min 64 chars) | `hex64string...` |
| `SESSION_SECRET` | Session secret | `hex64string...` |
| `ENCRYPTION_KEY` | Data encryption key | `hex32string` |
| `BCRYPT_ROUNDS` | Password hashing rounds | `12` |

### Tripay Payment Gateway

| Variable | Deskripsi | Contoh |
|----------|-----------|--------|
| `TRIPAY_MODE` | Mode: `sandbox` atau `production` | `production` |
| `TRIPAY_API_KEY` | API key dari Tripay | `key-xxx` |
| `TRIPAY_MERCHANT_CODE` | Merchant code | `TXXXXXX` |
| `TRIPAY_CALLBACK_KEY` | Private key untuk callback verification | `key-xxx` |

### Ultramsg WhatsApp

| Variable | Deskripsi | Contoh |
|----------|-----------|--------|
| `ULTRAMSG_INSTANCE_ID` | Instance ID | `instance12345` |
| `ULTRAMSG_TOKEN` | API Token | `token-xxx` |
| `ULTRAMSG_API_URL` | API URL template | `https://api.ultramsg.com/${instance}/instance` |

### Email (SMTP)

| Variable | Deskripsi | Contoh |
|----------|-----------|--------|
| `SMTP_HOST` | SMTP server host | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | `noreply@toko-saya.com` |
| `SMTP_PASS` | SMTP password | `password` |
| `SMTP_FROM` | From email address | `noreply@toko-saya.com` |
| `SMTP_TLS` | Use TLS | `true` |

### Logging

| Variable | Deskripsi | Default |
|----------|-----------|---------|
| `LOG_LEVEL` | Log level | `info` |
| `LOG_DIR` | Log directory | `/var/log/rectobase` |
| `PM2_HOME` | PM2 home directory | `/root/.pm2` |

### CORS

| Variable | Deskripsi | Contoh |
|----------|-----------|--------|
| `CORS_ORIGIN` | Allowed CORS origins | `https://pos.toko-saya.com` |

### Rate Limiting

| Variable | Deskripsi | Default |
|----------|-----------|---------|
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `900000` (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `100` |

---

## Cron Jobs

Script setup otomatis menambahkan cron jobs berikut:

| Cron | Schedule | Fungsi |
|------|----------|--------|
| Health check | `*/5 * * * *` | Cek API health setiap 5 menit |
| System monitor | `*/15 * * * *` | Cek RAM/Disk setiap 15 menit |
| Backup | `0 3 * * *` | Backup database setiap hari jam 3 pagi |
| SSL renew | `0 3 * * *` | Renew SSL setiap hari jam 3 pagi |

---

## Keamanan

### Yang sudah dikonfigurasi:

- Firewall UFW (hanya port 22, 80, 443)
- Fail2Ban (SSH brute-force protection)
- SSL Let's Encrypt (TLS 1.2/1.3)
- Security headers (HSTS, X-Frame-Options, dll)
- Rate limiting (5 req/min untuk auth, 100 req/min untuk API)
- Environment file permissions (600)

### Rekomendasi keamanan tambahan:

1. **Ganti SSH port default** (bukan 22)
2. **Setup SSH key only login** (disable password)
3. **Enable 2FA** untuk SSH
4. **Regular security updates**: `apt update && apt upgrade`
5. **Monitor logs** secara regular
6. **Backup offsite** ke S3/R2

---

## Support

- Documentation: https://docs.rectobase.com
- GitHub Issues: https://github.com/rectobase/rectobase/issues
- Email: support@rectobase.com
