// The only file that knows the shape of Nominatim (OpenStreetMap search) responses.
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/

import type { AdminLevel, Boundary, RegionBoundaryFinder, RegionCandidate } from "./types.ts";

const SEARCH_URL = "https://nominatim.openstreetmap.org/search";
// The usage policy asks for a User-Agent that identifies the application.
const USER_AGENT = "wayfindr/0.1 (personal tool; github.com/AZakkyMakarim/wayfindr)";
const TIMEOUT_MS = 20_000;

// OpenStreetMap admin_level values as used in Indonesia. Levels below 7
// (dusun, RW, RT) are not regions and are left out.
const ADMIN_LEVEL_BY_OSM_LEVEL: Record<string, AdminLevel> = {
  "4": "province",
  "5": "regency",
  "6": "district",
  "7": "village",
};

interface NominatimResult {
  osm_type: string;
  osm_id: number;
  category: string;
  type: string;
  name: string;
  display_name: string;
  extratags: Record<string, string> | null;
  geojson?: { type: string; coordinates: unknown };
}

function toBoundary(geojson: NominatimResult["geojson"]): Boundary | null {
  if (geojson?.type !== "Polygon" && geojson?.type !== "MultiPolygon") return null;
  return geojson as Boundary;
}

export class NominatimRegionBoundaryFinder implements RegionBoundaryFinder {
  // The usage policy asks for results to be cached; a search looks its region up again.
  #cache = new Map<string, RegionCandidate[]>();

  async findRegions(name: string): Promise<RegionCandidate[]> {
    const key = name.toLowerCase();
    const cached = this.#cache.get(key);
    if (cached) return cached;

    const url = new URL(SEARCH_URL);
    url.search = new URLSearchParams({
      q: name,
      countrycodes: "id",
      format: "jsonv2",
      polygon_geojson: "1",
      // Simplifies boundaries by about 5 m, which keeps large regions small enough to send to the browser.
      polygon_threshold: "0.00005",
      extratags: "1",
      limit: "20",
      "accept-language": "id",
    }).toString();
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OpenStreetMap menjawab ${res.status}.`);
    const results = (await res.json()) as NominatimResult[];

    const regions: RegionCandidate[] = [];
    for (const result of results) {
      if (result.category !== "boundary" || result.type !== "administrative") continue;
      const adminLevel = ADMIN_LEVEL_BY_OSM_LEVEL[result.extratags?.admin_level ?? ""];
      if (!adminLevel) continue;
      regions.push({
        id: `${result.osm_type}/${result.osm_id}`,
        name: result.name,
        description: result.display_name,
        adminLevel,
        boundary: toBoundary(result.geojson),
      });
    }
    this.#cache.set(key, regions);
    return regions;
  }
}
