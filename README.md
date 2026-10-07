# Wayfindr

Alat pribadi untuk mengumpulkan Tempat sejenis dari Google Maps dan membandingkannya. Istilah ada di `CONTEXT.md`.

## Menjalankan

```
npm install
npm start
```

Lalu buka http://localhost:4321. Data tersimpan di folder `data/` (basis data SQLite dan foto).

Penelusuran dikerjakan satu per satu lewat antrean, di satu jendela browser yang tetap terbuka selama aplikasi berjalan. Bila Google meminta CAPTCHA, antrean berhenti dengan status terjeda: selesaikan CAPTCHA sendiri di jendela itu, lalu tekan "Lanjutkan". Penelusuran yang terputus karena aplikasi ditutup juga menunggu "Lanjutkan".

## Pengembangan

- `npm test`: tes otomatis lewat API HTTP, dengan SQLite sungguhan serta Sumber Google Maps dan Pencari batas Wilayah palsu.
- `npm run typecheck`
- `npm run try-source -- "kopi susu" "Cilandak"`: uji coba manual Sumber Google Maps sungguhan. Jalankan ini bila hasil Penelusuran terlihat salah; kode yang membaca halaman Google Maps hanya ada di `src/server/google-maps-source/playwright.ts`.
- `npm run try-region -- "Cilandak"`: uji coba manual Pencari batas Wilayah sungguhan (Nominatim, OpenStreetMap). Kode yang membaca jawaban Nominatim hanya ada di `src/server/region-boundary-finder/nominatim.ts`.
