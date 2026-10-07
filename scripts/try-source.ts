// Manual trial of the real Google Maps source. Not part of the automated tests.
//
//   npm run try-source -- "kopi susu" "Cilandak"
//
// Opens a browser, runs one search, then prints the summary data of every
// result to compare with the real Google Maps. Cover photos are written to a
// temporary folder so they can be looked at.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlaywrightGoogleMapsSource } from "../src/server/google-maps-source/playwright.ts";

const [keyword = "kopi susu", region = "Cilandak"] = process.argv.slice(2);
const text = `${keyword} ${region}`;

console.log(`Searching Google Maps for "${text}"...`);
const source = new PlaywrightGoogleMapsSource();
const result = await source.findPlaces(text);
await source.close();

if (result.kind === "blocked") {
  console.log(`BLOCKED: ${result.reason}`);
  process.exit(1);
}

const photoDir = mkdtempSync(join(tmpdir(), "wayfindr-try-source-"));
console.table(
  result.places.map((place, i) => {
    if (place.coverPhoto) {
      const extension = place.coverPhoto.contentType.split("/")[1] ?? "bin";
      writeFileSync(join(photoDir, `${i}.${extension}`), place.coverPhoto.data);
    }
    return {
      name: place.name,
      rating: place.rating,
      reviews: place.reviewCount,
      category: place.categoryLabel,
      address: place.address,
      lat: place.position.lat,
      lng: place.position.lng,
      googleId: place.googleId,
      photo: place.coverPhoto
        ? `${place.coverPhoto.contentType} ${place.coverPhoto.data.length} B`
        : "-",
    };
  }),
);

const missing = (key: "rating" | "categoryLabel" | "address" | "coverPhoto") =>
  result.places.filter((place) => place[key] === null).length;
console.log(`${result.places.length} places.`);
console.log(
  `Without rating: ${missing("rating")}, without category label: ${missing("categoryLabel")}, ` +
    `without address: ${missing("address")}, without cover photo: ${missing("coverPhoto")}.`,
);
console.log(`Cover photos written to ${photoDir}`);
