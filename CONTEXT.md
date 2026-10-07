# Wayfindr

Alat pribadi untuk mengumpulkan tempat-tempat sejenis dari Google Maps dalam satu wilayah, lalu mengadu beberapa di antaranya untuk memutuskan mana yang lebih bagus.

## Language

**Tempat**:
Satu lokasi usaha atau fasilitas yang terdaftar di Google Maps, dikenali dari identitas Google-nya sehingga hanya ada satu meskipun ditemukan berkali-kali.
_Avoid_: Lokasi, bisnis, listing, POI

**Wilayah**:
Daerah administratif bernama (misalnya kecamatan atau kota) dengan batas tegas; Tempat di luar batasnya bukan bagian dari Wilayah itu.
_Avoid_: Area, radius, zona

**Kata Kunci**:
Teks pencarian bebas yang menyatakan jenis Tempat yang dicari, misalnya "kopi susu".
_Avoid_: Kategori, query, jenis

**Penelusuran**:
Satu permintaan mengumpulkan semua Tempat yang cocok dengan satu Kata Kunci di dalam satu Wilayah.
_Avoid_: Pencarian, scraping, job, Perbandingan

**Potret**:
Data sebuah Tempat seperti yang terlihat di Google Maps pada satu tanggal pengambilan.
_Avoid_: Snapshot, versi, scrape

**Data Ringkas**:
Bagian Potret yang didapat untuk setiap Tempat dari Penelusuran: nama, rating, jumlah ulasan, label kategori, alamat, dan posisi.
_Avoid_: Data dasar, data daftar

**Data Detail**:
Bagian Potret yang hanya ada setelah Ambil Detail: jam buka, rentang harga, telepon, situs web, dan sebaran bintang.
_Avoid_: Data lengkap, data tambahan

**Ambil Detail**:
Tindakan pengguna meminta Data Detail, Ulasan, dan Foto untuk Tempat-Tempat yang ia pilih.
_Avoid_: Pelengkapan, enrichment, pendalaman, update

**Foto Sampul**:
Satu foto utama sebuah Tempat yang ikut didapat bersama Data Ringkas.
_Avoid_: Thumbnail, foto profil

**Kelompok Foto**:
Pengelompokan foto sebuah Tempat menurut Google Maps, misalnya Menu, Suasana, Makanan & minuman, atau Dari pemilik; tidak setiap Tempat punya semua kelompok.
_Avoid_: Tab foto, kategori foto, album

**Ulasan**:
Satu penilaian pengunjung atas sebuah Tempat: jumlah bintang, teks, tanggal, dan balasan pemilik bila ada; identitas pengulas tidak termasuk.
_Avoid_: Review, komentar, testimoni

**Perbandingan**:
Tampilan sementara yang menyandingkan paling banyak lima Tempat pilihan pengguna dari Tempat yang sudah terkumpul; tidak disimpan dan boleh mencampur Tempat dari Penelusuran berbeda.
_Avoid_: Head to head, duel, Penelusuran, peserta

## Nama di kode

Kode (nama file, fungsi, variabel, kolom basis data, rute API, nama tes, komentar) ditulis dalam bahasa Inggris. Istilah di atas dipakai di dokumentasi, issue, dan teks yang tampil di layar. Padanannya di kode:

| Istilah | Di kode |
| --- | --- |
| Tempat | `place` |
| Wilayah | `region` |
| Kata Kunci | `keyword` |
| Penelusuran | `search` |
| Potret | `snapshot` |
| Data Ringkas | summary data |
| Data Detail | detail data |
| Ambil Detail | fetch details |
| Foto Sampul | `coverPhoto` |
| Kelompok Foto | `photoGroup` |
| Ulasan | `review` |
| Perbandingan | `comparison` |

Satu kueri ke Google Maps oleh Sumber Google Maps (`GoogleMapsSource`) bernama `findPlaces`, supaya tidak tertukar dengan `search`. Pencari batas Wilayah (`RegionBoundaryFinder`) mencari daerah yang cocok dengan satu nama lewat `findRegions`.
