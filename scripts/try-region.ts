// Manual trial of the real region boundary finder. Not part of the automated tests.
//
//   npm run try-region -- "Cilandak"
//
// Asks OpenStreetMap for the regions with that name and prints each candidate
// with its administrative level and the size of its boundary.

import { NominatimRegionBoundaryFinder } from "../src/server/region-boundary-finder/nominatim.ts";

const [name = "Cilandak"] = process.argv.slice(2);

console.log(`Looking up "${name}" in OpenStreetMap...`);
const regions = await new NominatimRegionBoundaryFinder().findRegions(name);

console.table(
  regions.map((region) => ({
    id: region.id,
    name: region.name,
    adminLevel: region.adminLevel,
    description: region.description,
    boundary: region.boundary
      ? `${region.boundary.type}, ${region.boundary.coordinates.flat(region.boundary.type === "Polygon" ? 1 : 2).length} points`
      : "-",
  })),
);
console.log(`${regions.length} candidates.`);
