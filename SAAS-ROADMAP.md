# RectoBase – SaaS Roadmap

## Status sekarang
Prototype HTML statis. Bisa didemoin ke klien, belum bisa dijual per bulan 
karena belum ada backend (data, auth, multi-tenant).

---

## Fase 1 – Deploy Demo (sekarang, 1 hari)

```
local → VPS → HTTPS → bisa ditunjukin ke klien
```

### Langkah deploy

**1. Ganti password VPS (WAJIB sekarang)**
```bash
ssh root@IP_VPS
passwd
```

**2. Setup SSH key (sekali seumur hidup)**
```bash
# Di Mac lo:
ssh-keygen -t ed25519 -C "rectobase-vps" -f ~/.ssh/rectobase_vps
ssh-copy-id -i ~/.ssh/rectobase_vps.pub root@IP_VPS
```

**3. Upload file setup ke VPS**
```bash
scp vps-setup.sh root@IP_VPS:/root/
```

**4. Jalankan setup di VPS**
```bash
ssh root@IP_VPS
bash /root/vps-setup.sh demo.rectobase.id email@lo.com
```

**5. Upload app dari Mac lo**
```bash
chmod +x deploy.sh
./deploy.sh root@IP_VPS demo.rectobase.id
```

**6. Selesai — buka https://demo.rectobase.id**

---

## Fase 2 – SaaS Real (1-3 bulan build)

Untuk bisa tagih Rp X.000/bulan per merchant, lo butuh:

### Backend stack (rekomendasi)

```
Frontend  : HTML/CSS/JS yang sudah ada (+ framework nanti)
Backend   : Node.js + Express  atau  Laravel (PHP)
Database  : PostgreSQL
Cache     : Redis
Payment   : Midtrans (paling umum di Indonesia)
Email     : Resend / Mailgun
Storage   : Cloudflare R2 / S3 (untuk foto produk)
```

### Fitur yang harus dibangun

#### Auth & Tenant
- [ ] Register merchant (nama toko, email, password)
- [ ] Login / logout
- [ ] JWT atau session-based auth
- [ ] Multi-tenant: 1 merchant = 1 isolated data
- [ ] Role: owner, kasir, staff

#### Core features (dari prototype)
- [ ] Kasir: order management dengan data real
- [ ] Menu management: CRUD produk + foto + harga
- [ ] Pelanggan: simpan & cari data pelanggan
- [ ] Penjualan: laporan & grafik dari data transaksi real
- [ ] Stock: manajemen inventaris dengan alert otomatis
- [ ] Kirim promo: integrasi WhatsApp Business API

#### Billing & Subscription
- [ ] Paket pricing (Starter / Pro / Business)
- [ ] Integrasi Midtrans untuk payment
- [ ] Auto-suspend jika belum bayar
- [ ] Invoice otomatis via email
- [ ] Trial 14 hari gratis

#### Admin panel (untuk lo sendiri)
- [ ] List semua merchant
- [ ] Revenue dashboard
- [ ] Manual activate / suspend tenant

---

## Pricing yang bisa lo pakai (contoh)

| Paket    | Harga/bln  | Limit          |
|----------|-----------|----------------|
| Starter  | Rp 99.000 | 1 outlet, 3 staff |
| Pro      | Rp 249.000 | 3 outlet, 10 staff |
| Business | Rp 599.000 | unlimited      |

---

## Fase 3 – Growth (nanti)

- Mobile app (React Native / Flutter dari codebase yang sama)
- Integrasi GoPay, OVO, QRIS
- WhatsApp chatbot untuk order
- Laporan pajak otomatis
- Marketplace menu (QR code customer order sendiri)

---

## Checklist sebelum jualan

- [x] App prototype berjalan
- [x] PWA (installable)
- [x] Deploy script siap
- [ ] VPS setup & HTTPS live
- [ ] Ganti password VPS
- [ ] SSH key setup
- [ ] Landing page (ceritain manfaat, bukan fitur)
- [ ] Nomor WhatsApp untuk demo / closing
- [ ] Backend API (untuk SaaS real)
- [ ] Payment gateway
