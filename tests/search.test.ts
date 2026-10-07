import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, type App } from "../src/server/app.ts";
import { FakeGoogleMapsSource } from "../src/server/google-maps-source/fake.ts";
import { FakeRegionBoundaryFinder } from "../src/server/region-boundary-finder/fake.ts";
import { cilandak, kopiNako, kopiTuku } from "./fixtures.ts";

let dir: string;
let source: FakeGoogleMapsSource;
let finder: FakeRegionBoundaryFinder;
let now: Date;
let app: App;

function openApp(): App {
  return createApp({
    source,
    regionBoundaryFinder: finder,
    databaseFile: join(dir, "wayfindr.db"),
    photoDir: join(dir, "photos"),
    now: () => now,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wayfindr-"));
  source = new FakeGoogleMapsSource();
  finder = new FakeRegionBoundaryFinder();
  finder.knows(cilandak);
  now = new Date("2026-10-07T03:00:00.000Z");
  app = openApp();
});

afterEach(() => {
  app.close();
  rmSync(dir, { recursive: true, force: true });
});

function createSearch(keyword: unknown, region: unknown) {
  return app.request("/api/searches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keyword, region }),
  });
}

async function listPlaces(): Promise<any[]> {
  const res = await app.request("/api/places");
  expect(res.status).toBe(200);
  return res.json();
}

test("a search stores each result as a place with a dated snapshot of its summary data", async () => {
  source.returns([kopiTuku, kopiNako]);

  const res = await createSearch("kopi susu", "Cilandak");

  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({
    keyword: "kopi susu",
    region: "Cilandak",
    status: "done",
    placeCount: 2,
  });
  const places = await listPlaces();
  expect(places).toHaveLength(2);
  expect(places.find((place) => place.name === "Toko Kopi Tuku")).toMatchObject({
    googleId: "0x2e69f1:0xaaa1",
    name: "Toko Kopi Tuku",
    rating: 4.6,
    reviewCount: 1234,
    categoryLabel: "Kedai Kopi",
    address: "Jl. Cipete Raya No.7",
    position: { lat: -6.2731, lng: 106.8042 },
    coverPhoto: null,
    snapshotDate: "2026-10-07T03:00:00.000Z",
  });
});

test("the region description is appended to the keyword as the text of a single Google Maps query", async () => {
  await createSearch("kopi susu", "Cilandak");

  expect(source.searchedTexts).toEqual([
    "kopi susu Cilandak, Jakarta Selatan, Daerah Khusus Ibukota Jakarta, Indonesia",
  ]);
});

test("the same result from two searches stays one place and shows its latest snapshot", async () => {
  source.returns([kopiTuku, kopiNako]);
  await createSearch("kopi susu", "Cilandak");

  now = new Date("2026-10-09T08:30:00.000Z");
  source.returns([{ ...kopiTuku, rating: 4.7, reviewCount: 1300 }]);
  const res = await createSearch("kedai kopi", "Cilandak");

  expect(await res.json()).toMatchObject({ placeCount: 1 });
  const places = await listPlaces();
  expect(places.map((place) => place.name).sort()).toEqual(["Kopi Nako", "Toko Kopi Tuku"]);
  expect(places.find((place) => place.name === "Toko Kopi Tuku")).toMatchObject({
    rating: 4.7,
    reviewCount: 1300,
    snapshotDate: "2026-10-09T08:30:00.000Z",
  });
  expect(places.find((place) => place.name === "Kopi Nako")).toMatchObject({
    snapshotDate: "2026-10-07T03:00:00.000Z",
  });
});

test("places are still there after the app is closed and opened again", async () => {
  source.returns([kopiTuku]);
  await createSearch("kopi susu", "Cilandak");

  app.close();
  app = openApp();

  expect(await listPlaces()).toMatchObject([{ name: "Toko Kopi Tuku", rating: 4.6 }]);
});

test("the cover photo is stored and can be fetched through the URL in the place list", async () => {
  const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  source.returns([{ ...kopiTuku, coverPhoto: { contentType: "image/jpeg", data } }]);
  await createSearch("kopi susu", "Cilandak");

  const [place] = await listPlaces();
  const res = await app.request(place.coverPhoto);

  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
});

test.each([
  ["an empty keyword", "  ", "Cilandak"],
  ["an empty region", "kopi susu", ""],
  ["a keyword that is not text", 42, "Cilandak"],
])("a search with %s is rejected without querying anything", async (_case, keyword, region) => {
  const res = await createSearch(keyword, region);

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: expect.any(String) });
  expect(source.searchedTexts).toEqual([]);
  expect(finder.lookedUpNames).toEqual([]);
});

test("a blocked search is marked failed with the reason and stores no places", async () => {
  source.blocks("Google Maps menampilkan CAPTCHA");

  const res = await createSearch("kopi susu", "Cilandak");

  expect(await res.json()).toMatchObject({
    status: "failed",
    failureReason: "Google Maps menampilkan CAPTCHA",
    placeCount: 0,
  });
  expect(await listPlaces()).toEqual([]);
});

test("a search whose Google Maps query throws is marked failed with the reason", async () => {
  source.fails("halaman tidak termuat");

  const res = await createSearch("kopi susu", "Cilandak");

  expect(await res.json()).toMatchObject({
    status: "failed",
    failureReason: "halaman tidak termuat",
  });
});
