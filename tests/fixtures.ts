import type { PlaceResult } from "../src/server/google-maps-source/types.ts";
import type { Boundary, RegionCandidate, Ring } from "../src/server/region-boundary-finder/types.ts";

export function rectangleRing(west: number, south: number, east: number, north: number): Ring {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

export function rectangle(west: number, south: number, east: number, north: number): Boundary {
  return { type: "Polygon", coordinates: [rectangleRing(west, south, east, north)] };
}

// Contains both kopiTuku and kopiNako.
export const cilandak: RegionCandidate = {
  id: "relation/5802424",
  name: "Cilandak",
  description: "Cilandak, Jakarta Selatan, Daerah Khusus Ibukota Jakarta, Indonesia",
  adminLevel: "district",
  boundary: rectangle(106.76, -6.32, 106.82, -6.26),
};

export const kopiTuku: PlaceResult = {
  googleId: "0x2e69f1:0xaaa1",
  name: "Toko Kopi Tuku",
  rating: 4.6,
  reviewCount: 1234,
  categoryLabel: "Kedai Kopi",
  address: "Jl. Cipete Raya No.7",
  position: { lat: -6.2731, lng: 106.8042 },
  coverPhoto: null,
};

export const kopiNako: PlaceResult = {
  googleId: "0x2e69f1:0xbbb2",
  name: "Kopi Nako",
  rating: 4.4,
  reviewCount: 870,
  categoryLabel: "Kafe",
  address: "Jl. Kemang Selatan No.10",
  position: { lat: -6.2702, lng: 106.8155 },
  coverPhoto: null,
};
