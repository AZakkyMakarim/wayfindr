import { useEffect, useState, type FormEvent } from "react";

interface Place {
  id: number;
  name: string;
  rating: number | null;
  reviewCount: number | null;
  categoryLabel: string | null;
  address: string | null;
  position: { lat: number; lng: number };
  coverPhoto: string | null;
  snapshotDate: string;
}

interface Search {
  keyword: string;
  region: string;
  status: "running" | "done" | "failed";
  failureReason: string | null;
  placeCount: number;
}

type Message = { isError: boolean; text: string } | null;

const numberFormat = new Intl.NumberFormat("id-ID");
const dateFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

async function fetchPlaces(): Promise<Place[]> {
  const res = await fetch("/api/places");
  if (!res.ok) throw new Error(`Gagal memuat daftar Tempat (${res.status}).`);
  return res.json();
}

export function App() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [keyword, setKeyword] = useState("");
  const [region, setRegion] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch((error: Error) => setMessage({ isError: true, text: error.message }));
  }, []);

  async function startSearch(event: FormEvent) {
    event.preventDefault();
    setIsSearching(true);
    setMessage({
      isError: false,
      text: "Penelusuran berjalan. Jendela browser akan terbuka; biarkan sampai tertutup sendiri.",
    });
    try {
      const res = await fetch("/api/searches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword, region }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage({ isError: true, text: body.error });
        return;
      }
      const search = body as Search;
      setMessage(
        search.status === "failed"
          ? { isError: true, text: `Penelusuran gagal: ${search.failureReason}` }
          : {
              isError: false,
              text: `Penelusuran "${search.keyword}" di ${search.region} selesai: ${search.placeCount} Tempat.`,
            },
      );
      setPlaces(await fetchPlaces());
    } catch (error) {
      setMessage({ isError: true, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <>
      <h1>Wayfindr</h1>
      <form onSubmit={startSearch}>
        <label>
          Kata Kunci
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="kopi susu"
            required
          />
        </label>
        <label>
          Wilayah
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="Cilandak"
            required
          />
        </label>
        <button type="submit" disabled={isSearching}>
          {isSearching ? "Menelusuri…" : "Mulai Penelusuran"}
        </button>
      </form>
      {message && <p className={message.isError ? "message error" : "message"}>{message.text}</p>}

      <p className="message">{numberFormat.format(places.length)} Tempat tersimpan.</p>
      <table>
        <thead>
          <tr>
            <th>Foto Sampul</th>
            <th>Nama</th>
            <th className="number">Rating</th>
            <th className="number">Jumlah ulasan</th>
            <th>Label kategori</th>
            <th>Alamat</th>
            <th>Posisi</th>
            <th>Potret</th>
          </tr>
        </thead>
        <tbody>
          {places.map((place) => (
            <tr key={place.id}>
              <td>{place.coverPhoto && <img src={place.coverPhoto} alt="" loading="lazy" />}</td>
              <td>{place.name}</td>
              <td className="number">
                {place.rating?.toLocaleString("id-ID", { minimumFractionDigits: 1 })}
              </td>
              <td className="number">
                {place.reviewCount !== null && numberFormat.format(place.reviewCount)}
              </td>
              <td>{place.categoryLabel}</td>
              <td>{place.address}</td>
              <td>
                {place.position.lat.toFixed(5)}, {place.position.lng.toFixed(5)}
              </td>
              <td>{dateFormat.format(new Date(place.snapshotDate))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
