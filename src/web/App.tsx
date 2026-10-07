import { useEffect, useRef, useState, type FormEvent } from "react";
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

type SearchStatus = "queued" | "running" | "paused" | "done" | "failed";

interface Search {
  id: number;
  keyword: string;
  region: string;
  status: SearchStatus;
  reason: string | null;
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

const STATUS_LABELS: Record<SearchStatus, string> = {
  queued: "Antre",
  running: "Berjalan",
  paused: "Terjeda",
  done: "Selesai",
  failed: "Gagal",
};
const POLL_INTERVAL_MS = 1500;

const numberFormat = new Intl.NumberFormat("id-ID");
const dateFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

async function fetchJson<T>(path: string, what: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Gagal memuat ${what} (${res.status}).`);
  return res.json();
}

export function App() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);
  const [keyword, setKeyword] = useState("");
  const [region, setRegion] = useState("");
  const [candidates, setCandidates] = useState<RegionCandidate[] | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const selectedRegion = candidates?.find((candidate) => candidate.id === selectedRegionId) ?? null;
  const [error, setError] = useState<string | null>(null);

  const [isPosting, setIsPosting] = useState(false);
  const latestRefresh = useRef(0);

  async function refresh() {
    const turn = ++latestRefresh.current;
    try {
      const [newSearches, newPlaces] = await Promise.all([
        fetchJson<Search[]>("/api/searches", "daftar Penelusuran"),
        fetchJson<Place[]>("/api/places", "daftar Tempat"),
      ]);
      // A refresh started earlier can answer later; its state is older, so drop it.
      if (turn !== latestRefresh.current) return;
      setSearches(newSearches);
      setPlaces(newPlaces);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function changeRegion(name: string) {
    setRegion(name);
    setCandidates(null);
    setSelectedRegionId(null);
  }

  async function lookUpRegion() {
    if (region.trim() === "") return;
    setIsLookingUp(true);
    setError(null);
    try {
      const res = await fetch(`/api/regions?name=${encodeURIComponent(region)}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error);
        return;
      }
      const found = body as RegionCandidate[];
      const usable = found.filter((candidate) => !candidate.rejection);
      setCandidates(found);
      setSelectedRegionId(usable.length === 1 ? usable[0]!.id : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLookingUp(false);
    }
  }

  // Statuses only change while the queue is working, so only then is there
  // anything to poll for.
  const isQueueWorking = searches.some(
    (search) => search.status === "queued" || search.status === "running",
  );
  const isQueuePaused = searches.some((search) => search.status === "paused");
  useEffect(() => {
    if (!isQueueWorking || isQueuePaused) return;
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isQueueWorking, isQueuePaused]);

  // Sends a request that changes the queue, then shows the new state.
  async function post(path: string, body?: unknown) {
    setError(null);
    setIsPosting(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const failure = await res.json().catch(() => null);
        setError(failure?.error ?? `Permintaan gagal (${res.status}).`);
        return;
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsPosting(false);
    }
  }

  function startSearch(event: FormEvent) {
    event.preventDefault();
    if (!selectedRegion) return;
    void post("/api/searches", { keyword, region, regionId: selectedRegion.id });
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
              disabled={isLookingUp || isPosting}
              required
            />
          </label>
          <button type="button" onClick={lookUpRegion} disabled={isLookingUp || isPosting}>
            {isLookingUp ? "Mencari…" : "Cari Wilayah"}
          </button>
          <button type="submit" disabled={!selectedRegion || isPosting}>
            Mulai Penelusuran
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
                  disabled={candidate.rejection !== null || isPosting}
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
      {error && <p className="message error">{error}</p>}

      {isQueuePaused && (
        <p className="message paused">
          Antrean pengambilan berhenti. Bila Google meminta CAPTCHA, selesaikan sendiri di jendela
          browser yang terbuka, lalu tekan Lanjutkan.
        </p>
      )}
      {searches.length > 0 && (
        <table className="searches">
          <thead>
            <tr>
              <th>Kata Kunci</th>
              <th>Wilayah</th>
              <th>Status</th>
              <th className="number">Tempat</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {searches.toReversed().map((search) => (
              <tr key={search.id}>
                <td>{search.keyword}</td>
                <td>{search.region}</td>
                <td>
                  <span className={`status ${search.status}`}>{STATUS_LABELS[search.status]}</span>
                  {search.reason && `: ${search.reason}`}
                </td>
                <td className="number">{numberFormat.format(search.placeCount)}</td>
                <td>
                  {search.status === "paused" && (
                    <button
                      disabled={isPosting}
                      onClick={() => post(`/api/searches/${search.id}/resume`)}
                    >
                      Lanjutkan
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
