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
  coverPhoto: string | null;
  snapshotDate: string;
  googleMapsUrl: string | null;
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

type SortColumn = "name" | "rating" | "reviewCount" | "categoryLabel" | "address" | "snapshotDate";

interface Sort {
  column: SortColumn;
  descending: boolean;
}

// Text fields hold what the user typed; an empty one means no filter.
interface Filters {
  searchId: string;
  categoryLabels: string[];
  minRating: string;
  minReviewCount: string;
}

const NO_FILTERS: Filters = { searchId: "", categoryLabels: [], minRating: "", minReviewCount: "" };

// The first click on these columns sorts the highest or newest value to the top.
const DESCENDING_FIRST: SortColumn[] = ["rating", "reviewCount", "snapshotDate"];

const numberFormat = new Intl.NumberFormat("id-ID");
const dateFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

async function fetchJson<T>(path: string, what: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    // The API explains a rejected request, such as a filter value it cannot read.
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Gagal memuat ${what} (${res.status}).`);
  }
  return res.json();
}

function placeListUrl(filters: Filters, sort: Sort | null): string {
  const params = new URLSearchParams();
  if (filters.searchId !== "") params.set("search", filters.searchId);
  for (const label of filters.categoryLabels) params.append("category", label);
  if (filters.minRating !== "") params.set("minRating", filters.minRating);
  if (filters.minReviewCount !== "") params.set("minReviewCount", filters.minReviewCount);
  if (sort) {
    params.set("sort", sort.column);
    params.set("order", sort.descending ? "desc" : "asc");
  }
  return `/api/places?${params}`;
}

export function App() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);
  const [categoryLabels, setCategoryLabels] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort | null>(null);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<number>>(new Set());
  const [keyword, setKeyword] = useState("");
  const [region, setRegion] = useState("");
  const [candidates, setCandidates] = useState<RegionCandidate[] | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const selectedRegion = candidates?.find((candidate) => candidate.id === selectedRegionId) ?? null;
  const [error, setError] = useState<string | null>(null);

  const [isPosting, setIsPosting] = useState(false);
  const latestRefresh = useRef(0);
  // Read through a ref so that a poll started earlier still asks for the
  // filters and order chosen since.
  const listUrl = placeListUrl(filters, sort);
  const currentListUrl = useRef(listUrl);
  currentListUrl.current = listUrl;

  async function refresh() {
    const turn = ++latestRefresh.current;
    try {
      const [newSearches, newPlaces, newCategoryLabels] = await Promise.all([
        fetchJson<Search[]>("/api/searches", "daftar Penelusuran"),
        fetchJson<Place[]>(currentListUrl.current, "daftar Tempat"),
        fetchJson<string[]>("/api/category-labels", "label kategori"),
      ]);
      // A refresh started earlier can answer later; its state is older, so drop it.
      if (turn !== latestRefresh.current) return;
      setSearches(newSearches);
      setPlaces(newPlaces);
      setCategoryLabels(newCategoryLabels);
    } catch (cause) {
      if (turn !== latestRefresh.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    // A rejected filter value is no longer the case once the filters change.
    setError(null);
    void refresh();
  }, [listUrl]);

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

  function sortBy(column: SortColumn) {
    setSort((current) =>
      current?.column === column
        ? { column, descending: !current.descending }
        : { column, descending: DESCENDING_FIRST.includes(column) },
    );
  }

  function toggleCategoryLabel(label: string) {
    setFilters((current) => ({
      ...current,
      categoryLabels: current.categoryLabels.includes(label)
        ? current.categoryLabels.filter((other) => other !== label)
        : [...current.categoryLabels, label],
    }));
  }

  function toggleChecked(id: number) {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function sortableHeader(column: SortColumn, title: string, className?: string) {
    const isSorted = sort?.column === column;
    return (
      <th
        className={className}
        aria-sort={isSorted ? (sort.descending ? "descending" : "ascending") : undefined}
      >
        <button type="button" className="sort" onClick={() => sortBy(column)}>
          {title}
          <span aria-hidden="true">{isSorted ? (sort.descending ? " ▼" : " ▲") : ""}</span>
        </button>
      </th>
    );
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

      <div className="filters">
        <label>
          Penelusuran
          <select
            value={filters.searchId}
            onChange={(e) => setFilters({ ...filters, searchId: e.target.value })}
          >
            <option value="">Semua Penelusuran</option>
            {searches.map((search) => (
              <option key={search.id} value={search.id}>
                {search.keyword} di {search.region}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rating minimum
          <input
            type="number"
            min="0"
            max="5"
            step="0.1"
            value={filters.minRating}
            onChange={(e) => setFilters({ ...filters, minRating: e.target.value })}
          />
        </label>
        <label>
          Jumlah ulasan minimum
          <input
            type="number"
            min="0"
            step="1"
            value={filters.minReviewCount}
            onChange={(e) => setFilters({ ...filters, minReviewCount: e.target.value })}
          />
        </label>
        <button type="button" onClick={() => setFilters(NO_FILTERS)}>
          Hapus saringan
        </button>
        {categoryLabels.length > 0 && (
          <fieldset>
            <legend>Label kategori</legend>
            {categoryLabels.map((label) => (
              <label key={label} className="choice">
                <input
                  type="checkbox"
                  checked={filters.categoryLabels.includes(label)}
                  onChange={() => toggleCategoryLabel(label)}
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}
      </div>

      <p className="message">
        {numberFormat.format(places.length)} Tempat ditampilkan,{" "}
        {numberFormat.format(checkedIds.size)} dicentang.{" "}
        {checkedIds.size > 0 && (
          <button type="button" onClick={() => setCheckedIds(new Set())}>
            Hapus centang
          </button>
        )}
      </p>
      <table>
        <thead>
          <tr>
            <th aria-label="Centang" />
            <th>Foto Sampul</th>
            {sortableHeader("name", "Nama")}
            {sortableHeader("rating", "Rating", "number")}
            {sortableHeader("reviewCount", "Jumlah ulasan", "number")}
            {sortableHeader("categoryLabel", "Label kategori")}
            {sortableHeader("address", "Alamat")}
            {sortableHeader("snapshotDate", "Potret terakhir")}
            <th>Google Maps</th>
          </tr>
        </thead>
        <tbody>
          {places.map((place) => (
            <tr key={place.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Centang ${place.name}`}
                  checked={checkedIds.has(place.id)}
                  onChange={() => toggleChecked(place.id)}
                />
              </td>
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
              <td>{dateFormat.format(new Date(place.snapshotDate))}</td>
              <td>
                {place.googleMapsUrl && (
                  <a href={place.googleMapsUrl} target="_blank" rel="noreferrer">
                    Buka di Google Maps
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
