import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, type App } from "../src/server/app.ts";
import { FakeGoogleMapsSource } from "../src/server/google-maps-source/fake.ts";
import { FakeRegionBoundaryFinder } from "../src/server/region-boundary-finder/fake.ts";
import type { Boundary, RegionCandidate } from "../src/server/region-boundary-finder/types.ts";
import { cilandak, kopiNako, kopiTuku, rectangle, rectangleRing } from "./fixtures.ts";

let dir: string;
let source: FakeGoogleMapsSource;
let finder: FakeRegionBoundaryFinder;
let app: App;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wayfindr-"));
  source = new FakeGoogleMapsSource();
  finder = new FakeRegionBoundaryFinder();
  app = createApp({
    source,
    regionBoundaryFinder: finder,
    databaseFile: join(dir, "wayfindr.db"),
    photoDir: join(dir, "photos"),
  });
});

afterEach(() => {
  app.close();
  rmSync(dir, { recursive: true, force: true });
});

const desaCilandak: RegionCandidate = {
  id: "relation/20167290",
  name: "Desa Cilandak",
  description: "Desa Cilandak, Kecamatan Anjatan, Indramayu, Jawa Barat, Indonesia",
  adminLevel: "village",
  boundary: rectangle(107.9, -6.38, 107.95, -6.32),
};

function lookUpRegions(name: string) {
  return app.request(`/api/regions?name=${encodeURIComponent(name)}`);
}

test("looking up a region name lists every matching candidate with its administrative level and boundary", async () => {
  finder.knows(cilandak, desaCilandak);

  const res = await lookUpRegions("Cilandak");

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([
    {
      id: "relation/5802424",
      name: "Cilandak",
      description: "Cilandak, Jakarta Selatan, Daerah Khusus Ibukota Jakarta, Indonesia",
      adminLevel: "district",
      adminLevelLabel: "Kecamatan",
      boundary: cilandak.boundary,
      rejection: null,
    },
    {
      id: "relation/20167290",
      name: "Desa Cilandak",
      description: "Desa Cilandak, Kecamatan Anjatan, Indramayu, Jawa Barat, Indonesia",
      adminLevel: "village",
      adminLevelLabel: "Kelurahan/Desa",
      boundary: desaCilandak.boundary,
      rejection: null,
    },
  ]);
});

const jakartaSelatan: RegionCandidate = {
  id: "relation/7625977",
  name: "Jakarta Selatan",
  description: "Jakarta Selatan, Daerah Khusus Ibukota Jakarta, Indonesia",
  adminLevel: "regency",
  boundary: rectangle(106.7, -6.37, 106.86, -6.2),
};

const jawaBarat: RegionCandidate = {
  id: "relation/2388361",
  name: "Jawa Barat",
  description: "Jawa Barat, Indonesia",
  adminLevel: "province",
  boundary: rectangle(106.3, -7.9, 108.9, -5.9),
};

const pasarMinggu: RegionCandidate = {
  id: "relation/5802433",
  name: "Pasar Minggu",
  description: "Pasar Minggu, Jakarta Selatan, Daerah Khusus Ibukota Jakarta, Indonesia",
  adminLevel: "district",
  boundary: null,
};

test.each([
  ["a regency or city", jakartaSelatan, "Kabupaten/Kota"],
  ["a province", jawaBarat, "Provinsi"],
])("%s is listed with the reason it cannot be searched", async (_case, region, label) => {
  finder.knows(region);

  const [candidate] = await (await lookUpRegions(region.name)).json();

  expect(candidate).toMatchObject({ adminLevelLabel: label });
  expect(candidate.rejection).toContain("kecamatan");
});

test("a candidate without a boundary polygon is listed with the reason it cannot be searched", async () => {
  finder.knows(pasarMinggu);

  const [candidate] = await (await lookUpRegions("Pasar Minggu")).json();

  expect(candidate).toMatchObject({ boundary: null });
  expect(candidate.rejection).toContain("poligon batas");
});

test("looking up a name no region has returns an empty list", async () => {
  finder.knows(cilandak);

  const res = await lookUpRegions("Atlantis");

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("looking up an empty name is rejected without asking the region boundary finder", async () => {
  const res = await lookUpRegions("  ");

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: expect.any(String) });
  expect(finder.lookedUpNames).toEqual([]);
});

test("a failing region boundary finder is reported with the reason", async () => {
  finder.fails("OpenStreetMap tidak menjawab");

  const res = await lookUpRegions("Cilandak");

  expect(res.status).toBe(502);
  expect((await res.json()).error).toContain("OpenStreetMap tidak menjawab");
});

function createSearch(keyword: string, region: string, regionId?: string) {
  return app.request("/api/searches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keyword, region, regionId }),
  });
}

async function listPlaces(): Promise<any[]> {
  return (await app.request("/api/places")).json();
}

async function expectRejected(res: Response, messagePart: string) {
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain(messagePart);
  expect(source.searchedTexts).toEqual([]);
}

test("a search in a name shared by several regions runs in the one that was picked", async () => {
  finder.knows(cilandak, desaCilandak);

  const res = await createSearch("kopi susu", "Cilandak", "relation/20167290");

  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ region: "Desa Cilandak", status: "done" });
  expect(source.searchedTexts).toEqual([
    "kopi susu Desa Cilandak, Kecamatan Anjatan, Indramayu, Jawa Barat, Indonesia",
  ]);
});

test("a search in a name shared by several regions is rejected until one is picked", async () => {
  finder.knows(cilandak, desaCilandak);

  await expectRejected(await createSearch("kopi susu", "Cilandak"), "pilih salah satu");
});

test("a search in a picked region that does not match the name is rejected", async () => {
  finder.knows(cilandak, desaCilandak);

  await expectRejected(
    await createSearch("kopi susu", "Cilandak", "relation/999"),
    "tidak ada di antara",
  );
});

test("a search in a name no region has is rejected", async () => {
  finder.knows(cilandak);

  await expectRejected(await createSearch("kopi susu", "Atlantis"), "Atlantis");
});

test("a search in a region without a boundary polygon is rejected", async () => {
  finder.knows(pasarMinggu);

  await expectRejected(await createSearch("kopi susu", "Pasar Minggu"), "poligon batas");
});

test.each([
  ["a regency or city", jakartaSelatan],
  ["a province", jawaBarat],
])("a search in %s is rejected", async (_case, region) => {
  finder.knows(region);

  await expectRejected(await createSearch("kopi susu", region.name), "kecamatan");
});

test.each([
  ["a district", cilandak],
  ["a village", desaCilandak],
])("a search in %s is accepted", async (_case, region) => {
  finder.knows(region);

  const res = await createSearch("kopi susu", region.name);

  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ status: "done" });
});

test("a search is rejected with the reason when the region boundary finder fails", async () => {
  finder.fails("OpenStreetMap tidak menjawab");

  const res = await createSearch("kopi susu", "Cilandak");

  expect(res.status).toBe(502);
  expect((await res.json()).error).toContain("OpenStreetMap tidak menjawab");
  expect(source.searchedTexts).toEqual([]);
});

function placeAt(name: string, lat: number, lng: number) {
  return { ...kopiTuku, googleId: `0x1:${name}`, name, position: { lat, lng } };
}

test("places outside the region boundary are not stored as results of the search", async () => {
  finder.knows(cilandak);
  source.returns([
    kopiTuku,
    placeAt("North of the boundary", -6.25, 106.8),
    placeAt("East of the boundary", -6.29, 106.83),
    kopiNako,
  ]);

  const res = await createSearch("kopi susu", "Cilandak");

  expect(await res.json()).toMatchObject({ status: "done", placeCount: 2 });
  expect((await listPlaces()).map((place) => place.name)).toEqual(["Toko Kopi Tuku", "Kopi Nako"]);
});

test("the boundary is followed along slanted edges, not just its bounding box", async () => {
  // A triangle with corners at the south-west, south-east and north-west.
  const triangle: Boundary = {
    type: "Polygon",
    coordinates: [
      [
        [106.0, -6.1],
        [106.1, -6.1],
        [106.0, -6.0],
        [106.0, -6.1],
      ],
    ],
  };
  finder.knows({ ...cilandak, boundary: triangle });
  source.returns([
    placeAt("Near the south-west corner", -6.08, 106.02),
    placeAt("Near the north-east corner", -6.02, 106.08),
  ]);

  await createSearch("kopi susu", "Cilandak");

  expect((await listPlaces()).map((place) => place.name)).toEqual(["Near the south-west corner"]);
});

test("places in a hole of the region boundary are outside it", async () => {
  const withHole: Boundary = {
    type: "Polygon",
    coordinates: [
      rectangleRing(106.0, -6.4, 106.4, -6.0),
      rectangleRing(106.1, -6.3, 106.3, -6.1),
    ],
  };
  finder.knows({ ...cilandak, boundary: withHole });
  source.returns([placeAt("In the hole", -6.2, 106.2), placeAt("On the rim", -6.05, 106.2)]);

  await createSearch("kopi susu", "Cilandak");

  expect((await listPlaces()).map((place) => place.name)).toEqual(["On the rim"]);
});

test("places in any part of a region made of several polygons are inside it", async () => {
  const twoParts: Boundary = {
    type: "MultiPolygon",
    coordinates: [
      [rectangleRing(106.0, -6.1, 106.1, -6.0)],
      [rectangleRing(106.3, -6.1, 106.4, -6.0)],
    ],
  };
  finder.knows({ ...cilandak, boundary: twoParts });
  source.returns([
    placeAt("In the west part", -6.05, 106.05),
    placeAt("Between the parts", -6.05, 106.2),
    placeAt("In the east part", -6.05, 106.35),
  ]);

  await createSearch("kopi susu", "Cilandak");

  expect((await listPlaces()).map((place) => place.name)).toEqual([
    "In the west part",
    "In the east part",
  ]);
});
