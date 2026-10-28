---
title: KlaimGuard
emoji: 🛡️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

# KlaimGuard AI

Prototype Healthkaton untuk analisis sintetis klaim JKN dan simulasi permintaan klarifikasi BPJS–rumah sakit.

## Role demo

- **Admin Verifikator**: menggunakan konfigurasi `ADMIN_BPJS_USERNAME` dan `ADMIN_BPJS_PASSWORD`; default demo pada pengembangan adalah `admin.bpjs` / `admin123!`. Peran ini mencakup analisis klaim, keputusan verifikasi, audit trail, dan tindak lanjut klarifikasi.
- **Petugas Klaim RS**: akun demo `petugas.rs` / `rsdemo123!`, terikat pada kode faskes `RS-DEMO-001`. Konfigurasi dapat diubah melalui `RS_DEMO_USERNAME`, `RS_DEMO_PASSWORD`, dan `RS_DEMO_FACILITY_CODE`.

Kredensial default hanya untuk demonstrasi lokal. Jangan gunakan kredensial tersebut untuk deployment bersama atau produksi.

## Alur klarifikasi

1. Admin Verifikator menyusun draf klarifikasi dari klaim dan temuan analisis.
2. Admin Verifikator memeriksa draf, meminta revisi bila perlu, atau menyetujui dan langsung mengirimkannya ke faskes yang ditautkan pada klaim.
3. Petugas RS mengisi penjelasan, menyimpan draf, mengunggah dokumen PDF/JPG/JPEG (maksimal 10 MB per berkas), lalu mengirim respons.
4. Admin Verifikator menilai respons RS, menerima penjelasan, atau meminta klarifikasi tambahan.
5. Status “Selesai di aplikasi” hanya menutup pencatatan pada prototype, bukan keputusan resmi BPJS.

Batas respons demo adalah tiga hari kalender sejak pengiriman. Data faskes dan klaim yang ditautkan oleh seed merupakan data sintetis untuk demonstrasi.

## Menjalankan seed portal RS

`run.py` menjalankan seed portal RS setelah seed dataset klaim. Untuk menambahkan data demo tanpa menginisialisasi ulang dataset yang sudah ada:

```powershell
python -m backend.scripts.seed_rs_demo
```

Seed membuat satu faskes demo, menautkan dataset sintetis ke faskes demo, dan menyiapkan permintaan klarifikasi contoh dengan temuan koding dan administratif serta dokumen contoh sintetis.

Skema baru diterapkan dengan perubahan additive saat aplikasi mulai. Jangan gunakan `backend.scripts.init_db` pada database yang datanya ingin dipertahankan karena script tersebut menginisialisasi ulang dataset demo.

## Regulasi

Dokumen yang ditambahkan ke `backend/regulation_docs/` sebaiknya diunduh dari [JDIH Kementerian Kesehatan](https://jdih.kemkes.go.id/documents/peraturan-menteri-kesehatan-nomor-26-tahun-2021) atau [halaman dokumen JDIH BPK](https://peraturan.bpk.go.id/Details/353186/permenkes-no-26-tahun-2021). Pastikan menggunakan berkas `2021permenkes026.pdf` dan mencatat sumber serta metadata statusnya. JDIH Kemenkes menyatakan Permenkes 26/2021 berlaku dan mencabut Permenkes 76/2016.
