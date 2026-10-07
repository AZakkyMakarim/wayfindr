import { useEffect, useState, type FormEvent } from "react";
import type { Boundary } from "../server/region-boundary-finder/types.ts";
import { RegionPreview } from "./RegionPreview.tsx";

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

// A region whose name matches what was typed; rejection says why it cannot be searched.
interface RegionCandidate {
  id: string;
  name: string;
  description: string;
  adminLevelLabel: string;
  boundary: Boundary | null;
  rejection: string | null;
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
  const [candidates, setCandidates] = useState<RegionCandidate[] | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const selectedRegion = candidates?.find((candidate) => candidate.id === selectedRegionId) ?? null;

  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch((error: Error) => setMessage({ isError: true, text: error.message }));
  }, []);

  function changeRegion(name: string) {
    setRegion(name);
    setCandidates(null);
    setSelectedRegionId(null);
  }

  async function lookUpRegion() {
    if (region.trim() === "") return;
    setIsLookingUp(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/regions?name=${encodeURIComponent(region)}`);
      const body = await res.json();
      if (!res.ok) {
        setMessage({ isError: true, text: body.error });
        return;
      }
      const found = body as RegionCandidate[];
      const usable = found.filter((candidate) => !candidate.rejection);
      setCandidates(found);
      setSelectedRegionId(usable.length === 1 ? usable[0]!.id : null);
    } catch (error) {
      setMessage({ isError: true, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsLookingUp(false);
    }
  }

  async function startSearch(event: FormEvent) {
    event.preventDefault();
    if (!selectedRegion) return;
    setIsSearching(true);
    setMessage({
      isError: false,
      text: "Penelusuran berjalan. Jendela browser akan terbuka; biarkan sampai tertutup sendiri.",
    });
    try {
      const res = await fetch("/api/searches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword, region, regionId: selectedRegion.id }),
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
        <div
          className="fields"
          onKeyDown={(e) => {
            // Enter in a text field looks the region up first; a search needs a picked region.
            if (e.key !== "Enter" || selectedRegion || !(e.target instanceof HTMLInputElement)) return;
            e.preventDefault();
            lookUpRegion();
          }}
        >
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
              onChange={(e) => changeRegion(e.target.value)}
              placeholder="Cilandak"
              // The candidates belong to the name that was looked up, so it cannot change under them.
              disabled={isLookingUp || isSearching}
              required
            />
          </label>
          <button type="button" onClick={lookUpRegion} disabled={isLookingUp || isSearching}>
            {isLookingUp ? "Mencari…" : "Cari Wilayah"}
          </button>
          <button type="submit" disabled={!selectedRegion || isSearching}>
            {isSearching ? "Menelusuri…" : "Mulai Penelusuran"}
          </button>
        </div>
        {candidates?.length === 0 && (
          <p className="message error">Tidak ada daerah bernama "{region}" di OpenStreetMap.</p>
        )}
        {candidates && candidates.length > 0 && (
          <fieldset className="candidates">
            <legend>Daerah yang cocok</legend>
            {candidates.map((candidate) => (
              <label key={candidate.id} className={candidate.rejection ? "rejected" : undefined}>
                <input
                  type="radio"
                  name="region"
                  checked={candidate.id === selectedRegionId}
                  disabled={candidate.rejection !== null || isSearching}
                  onChange={() => setSelectedRegionId(candidate.id)}
                />
                <span>
                  <strong>{candidate.adminLevelLabel}</strong> {candidate.description}
                  {candidate.rejection && <small>{candidate.rejection}</small>}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {selectedRegion?.boundary && <RegionPreview boundary={selectedRegion.boundary} />}
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
