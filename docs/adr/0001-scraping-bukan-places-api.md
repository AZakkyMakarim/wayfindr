# Data diambil dengan scraping Google Maps, bukan Places API resmi

Wayfindr mengambil data Tempat dengan mengotomasi browser di halaman Google Maps, bukan lewat Google Places API. Alasannya tiga: tidak mau membayar atau mendaftarkan kartu kredit ke Google Cloud, butuh lebih dari 60 hasil per pencarian (batas API), dan nantinya ingin mengambil isi ulasan dalam jumlah banyak (API hanya memberi sekitar 5 per Tempat).

## Consequences

- Melanggar ketentuan layanan Google Maps; hanya untuk pemakaian pribadi, satu pengguna, volume rendah (ratusan Tempat per bulan).
- Bisa diblokir atau kena CAPTCHA, dan rusak setiap kali tampilan Maps berubah. Kode yang membaca halaman Maps harus terisolasi supaya perbaikannya tidak menjalar.
- Jangan "diperbaiki" dengan pindah ke Places API tanpa meninjau ketiga alasan di atas.
