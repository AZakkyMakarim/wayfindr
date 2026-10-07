import type { AdminLevel, Boundary, RegionCandidate, Ring } from "./region-boundary-finder/types.ts";

// Shown to the user, so in Indonesian.
export const ADMIN_LEVEL_LABELS: Record<AdminLevel, string> = {
  province: "Provinsi",
  regency: "Kabupaten/Kota",
  district: "Kecamatan",
  village: "Kelurahan/Desa",
};

// The reason a candidate cannot be the region of a search, or null if it can.
export function regionRejection(candidate: RegionCandidate): string | null {
  if (candidate.adminLevel === "province" || candidate.adminLevel === "regency") {
    return `${candidate.name} adalah ${ADMIN_LEVEL_LABELS[candidate.adminLevel]}. Wilayah hanya boleh kecamatan, kelurahan, atau desa.`;
  }
  if (!candidate.boundary) {
    return `${candidate.name} tidak punya poligon batas di OpenStreetMap.`;
  }
  return null;
}

// Ray casting: a point is inside a ring if a ray from it crosses the ring an odd number of times.
function isInsideRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngI, latI] = ring[i]!;
    const [lngJ, latJ] = ring[j]!;
    if (latI > lat !== latJ > lat && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI) {
      inside = !inside;
    }
  }
  return inside;
}

export function isInsideBoundary(
  position: { lat: number; lng: number },
  boundary: Boundary,
): boolean {
  const polygons = boundary.type === "Polygon" ? [boundary.coordinates] : boundary.coordinates;
  return polygons.some(([outline, ...holes]) => {
    if (!outline || !isInsideRing(position.lng, position.lat, outline)) return false;
    return !holes.some((hole) => isInsideRing(position.lng, position.lat, hole));
  });
}
