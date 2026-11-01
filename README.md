# Timer Workout + GPX

Dua menu di satu aplikasi (tab bar bawah), dibangun dengan [Nuxt](https://nuxt.com) sebagai situs statis:

- **Timer**: timer workout interval (`app/pages/timer.vue`)
- **GPX**: buat file GPX dari rute sepeda, motor, atau mobil (`app/pages/gpx.vue`)

Timer yang sedang jalan tidak berhenti saat pindah tab. Alamat memakai hash: `/#/timer` dan `/#/gpx`.

## Jalankan

```bash
npm install     # sekali saja
npm run dev     # http://localhost:8766, perubahan kode langsung tampil
```


## Deploy ke GitHub Pages

Push ke `main`; workflow `.github/workflows/deploy.yml` membangun dan menerbitkannya.
Sekali saja di GitHub: **Settings → Pages → Source: GitHub Actions**.

Coba build lokal:

```bash
NUXT_APP_BASE_URL=/sport/ npm run generate   # hasil di .output/public
```

## Struktur

```
app/
  layouts/default.vue   tab bar bawah
  pages/                timer.vue, gpx.vue
  components/           DrumPicker.vue (pemilih putar)
  utils/                routing.js (rute, tempat, elevasi, GPX), googleMaps.js (baca link embed)
  assets/css/theme.css  warna dan banner bersama
legacy/                 versi HTML tunggal sebelum pindah ke Nuxt
```
