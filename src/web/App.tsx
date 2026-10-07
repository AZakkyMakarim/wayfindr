import { useCallback, useEffect, useState, type FormEvent } from "react";

interface Place {
  id: number;
  name: string;
  rating: number | null;
  reviewCount: number | null;
  categoryLabel: string | null;
  address: string | null;
  coverPhoto: string | null;
  snapshotDate: string;
  googleMapsUrl: string;
}

interface Search {
  id: number;
  keyword: string;
  region: string;
  status: "running" | "done" | "failed";
  failureReason: string | null;
  placeCount: number;
}

type Message = { isError: boolean; text: string } | null;

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

async function fetchJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
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
  // Bumped after a search so the lists are loaded again.
  const [dataVersion, setDataVersion] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [region, setRegion] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const showError = useCallback(
    (error: unknown) =>
      setMessage({ isError: true, text: error instanceof Error ? error.message : String(error) }),
    [],
  );

  useEffect(() => {
    // A slower, older answer must not replace the list of a newer filter.
    let isCurrent = true;
    fetchJson<Place[]>(placeListUrl(filters, sort), "daftar Tempat")
      .then((loaded) => {
        if (isCurrent) setPlaces(loaded);
      })
      .catch((error) => {
        if (isCurrent) showError(error);
      });
    return () => {
      isCurrent = false;
    };
  }, [filters, sort, dataVersion, showError]);

  useEffect(() => {
    fetchJson<Search[]>("/api/searches", "daftar Penelusuran").then(setSearches).catch(showError);
    fetchJson<string[]>("/api/category-labels", "label kategori")
      .then(setCategoryLabels)
      .catch(showError);
  }, [dataVersion, showError]);

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
      setDataVersion((version) => version + 1);
    } catch (error) {
      showError(error);
    } finally {
      setIsSearching(false);
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
                <a href={place.googleMapsUrl} target="_blank" rel="noreferrer">
                  Buka di Google Maps
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
