// Region boundary finder ("Pencari batas Wilayah"): the only part of the system
// that knows where region boundaries come from (OpenStreetMap). Everything else
// only knows the types in this file.

// A closed ring of [lng, lat] points, as in GeoJSON.
export type Ring = [lng: number, lat: number][];

// GeoJSON geometry: the first ring of a polygon is its outline, the rest are holes.
export type Boundary =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };

// Indonesian administrative levels, largest first; a village is a kelurahan or desa.
export type AdminLevel = "province" | "regency" | "district" | "village";

// One region whose name matches what the user typed.
export interface RegionCandidate {
  id: string;
  name: string;
  // Tells apart regions with the same name, e.g. "Cilandak, Jakarta Selatan, ...".
  description: string;
  adminLevel: AdminLevel;
  boundary: Boundary | null;
}

export interface RegionBoundaryFinder {
  findRegions(name: string): Promise<RegionCandidate[]>;
}
