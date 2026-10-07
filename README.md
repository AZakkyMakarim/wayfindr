# Wayfindr

Alat pribadi untuk mengumpulkan Tempat sejenis dari Google Maps dan membandingkannya. Istilah ada di `CONTEXT.md`.

## Menjalankan

```
npm install
npm start
```

Lalu buka http://localhost:4321. Data tersimpan di folder `data/` (basis data SQLite dan foto).

## Pengembangan

- `npm test`: tes otomatis lewat API HTTP, dengan SQLite sungguhan dan Sumber Google Maps palsu.
- `npm run typecheck`
- `npm run try-source -- "kopi susu" "Cilandak"`: uji coba manual Sumber Google Maps sungguhan. Jalankan ini bila hasil Penelusuran terlihat salah; kode yang membaca halaman Google Maps hanya ada di `src/server/google-maps-source/playwright.ts`.
