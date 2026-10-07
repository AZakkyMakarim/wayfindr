// Google Maps source ("Sumber Google Maps"): the only part of the system that
// knows the shape of Google Maps pages (ADR 0001). Everything else only knows
// the types in this file.

export interface CoverPhoto {
  contentType: string;
  data: Uint8Array;
}

// Summary data ("Data Ringkas") of one place, plus its cover photo.
export interface PlaceResult {
  googleId: string;
  name: string;
  rating: number | null;
  reviewCount: number | null;
  categoryLabel: string | null;
  address: string | null;
  position: { lat: number; lng: number };
  coverPhoto: CoverPhoto | null;
}

export type FindPlacesResult =
  | { kind: "ok"; places: PlaceResult[] }
  | { kind: "blocked"; reason: string };

export interface GoogleMapsSource {
  findPlaces(text: string): Promise<FindPlacesResult>;
}
