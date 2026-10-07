import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, type App } from "../src/server/app.ts";
import { FakeGoogleMapsSource } from "../src/server/google-maps-source/fake.ts";
import { FakeRegionBoundaryFinder } from "../src/server/region-boundary-finder/fake.ts";
import { cilandak, kopiNako, kopiTuku } from "./fixtures.ts";
import * as waits from "./waiting.ts";

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

function fetchSearch(id: number): Promise<any> {
  return waits.fetchSearch(app, id);
}

// The text Google Maps is queried with for a keyword in the region of these tests.
function queryFor(keyword: string): string {
  return `${keyword} Cilandak, Jakarta Selatan, Daerah Khusus Ibukota Jakarta, Indonesia`;
}

function waitUntilSettled(id: number): Promise<any> {
  return waits.waitUntilSettled(app, id);
}

function waitUntilRunning(id: number): Promise<void> {
  return waits.waitUntilRunning(app, id);
}

// Creates a search and waits until the queue has stopped working on it.
async function runSearch(keyword: string, region: string): Promise<any> {
  const res = await createSearch(keyword, region);
  expect(res.status).toBe(201);
  return waitUntilSettled((await res.json()).id);
}

async function createdSearch(keyword: string, region: string): Promise<any> {
  return (await createSearch(keyword, region)).json();
}

function resumeSearch(id: number) {
  return app.request(`/api/searches/${id}/resume`, { method: "POST" });
}

async function listSearches(): Promise<any[]> {
  const res = await app.request("/api/searches");
  expect(res.status).toBe(200);
  return res.json();
}

// Long enough for the queue to start a search if it were going to.
function queueHadTimeToMove(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

async function listPlaces(): Promise<any[]> {
  const res = await app.request("/api/places");
  expect(res.status).toBe(200);
  return res.json();
}

test("a search stores each result as a place with a dated snapshot of its summary data", async () => {
  source.returns([kopiTuku, kopiNako]);

  const search = await runSearch("kopi susu", "Cilandak");

  expect(search).toMatchObject({
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
  await runSearch("kopi susu", "Cilandak");

  expect(source.searchedTexts).toEqual([
    "kopi susu Cilandak, Jakarta Selatan, Daerah Khusus Ibukota Jakarta, Indonesia",
  ]);
});

test("the same result from two searches stays one place and shows its latest snapshot", async () => {
  source.returns([kopiTuku, kopiNako]);
  await runSearch("kopi susu", "Cilandak");

  now = new Date("2026-10-09T08:30:00.000Z");
  source.returns([{ ...kopiTuku, rating: 4.7, reviewCount: 1300 }]);
  const search = await runSearch("kedai kopi", "Cilandak");

  expect(search).toMatchObject({ placeCount: 1 });
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
  await runSearch("kopi susu", "Cilandak");

  app.close();
  app = openApp();

  expect(await listPlaces()).toMatchObject([{ name: "Toko Kopi Tuku", rating: 4.6 }]);
});

test("the cover photo is stored and can be fetched through the URL in the place list", async () => {
  const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  source.returns([{ ...kopiTuku, coverPhoto: { contentType: "image/jpeg", data } }]);
  await runSearch("kopi susu", "Cilandak");

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

test("a search whose Google Maps query throws is marked failed with the reason", async () => {
  source.fails("halaman tidak termuat");

  const search = await runSearch("kopi susu", "Cilandak");

  expect(search).toMatchObject({ status: "failed", reason: "halaman tidak termuat" });
});

test("a new search is queued, runs while Google Maps is queried, and ends up done", async () => {
  const release = source.holds();
  source.returns([kopiTuku]);

  const res = await createSearch("kopi susu", "Cilandak");
  const created = await res.json();

  expect(res.status).toBe(201);
  expect(created).toMatchObject({ status: "queued", reason: null, placeCount: 0 });
  await waitUntilRunning(created.id);

  release();

  expect(await waitUntilSettled(created.id)).toMatchObject({ status: "done", placeCount: 1 });
});

test("a second search waits in the queue until the first is finished", async () => {
  const release = source.holds();
  const first = await createdSearch("kopi susu", "Cilandak");
  const second = await createdSearch("bakso", "Cilandak");
  await waitUntilRunning(first.id);

  expect(await fetchSearch(second.id)).toMatchObject({ status: "queued" });
  expect(source.searchedTexts).toEqual([queryFor("kopi susu")]);

  release();

  expect(await waitUntilSettled(second.id)).toMatchObject({ status: "done" });
  expect(await fetchSearch(first.id)).toMatchObject({ status: "done" });
  expect(source.searchedTexts).toEqual([queryFor("kopi susu"), queryFor("bakso")]);
});

test("the search list shows every search with its status and place count", async () => {
  source.returns([kopiTuku, kopiNako]);
  await runSearch("kopi susu", "Cilandak");
  source.fails("halaman tidak termuat");
  await runSearch("bakso", "Cilandak");

  expect(await listSearches()).toMatchObject([
    { keyword: "kopi susu", region: "Cilandak", status: "done", reason: null, placeCount: 2 },
    { keyword: "bakso", status: "failed", reason: "halaman tidak termuat", placeCount: 0 },
  ]);
});

test("a failed search does not hold the queue", async () => {
  const release = source.holds();
  source.fails("halaman tidak termuat");
  const failed = await createdSearch("kopi susu", "Cilandak");
  const next = await createdSearch("bakso", "Cilandak");
  await waitUntilRunning(failed.id);

  release();

  expect(await waitUntilSettled(failed.id)).toMatchObject({ status: "failed" });
  await waitUntilSettled(next.id);
  expect(source.searchedTexts).toEqual([queryFor("kopi susu"), queryFor("bakso")]);
});

test("a blocked search is paused with the reason, stores no places, and holds the queue", async () => {
  source.blocks("Google Maps menampilkan CAPTCHA.");
  const blocked = await createdSearch("kopi susu", "Cilandak");
  const waiting = await createdSearch("bakso", "Cilandak");

  expect(await waitUntilSettled(blocked.id)).toMatchObject({
    status: "paused",
    reason: "Google Maps menampilkan CAPTCHA.",
    placeCount: 0,
  });

  // Nothing moves again until the user resumes, not even for a new search.
  source.returns([kopiTuku]);
  const later = await createdSearch("soto", "Cilandak");
  await queueHadTimeToMove();
  expect(await fetchSearch(waiting.id)).toMatchObject({ status: "queued" });
  expect(await fetchSearch(later.id)).toMatchObject({ status: "queued" });
  expect(source.searchedTexts).toEqual([queryFor("kopi susu")]);
  expect(await listPlaces()).toEqual([]);
});

test("resuming a paused search runs it again and then the rest of the queue", async () => {
  source.blocks("Google Maps menampilkan CAPTCHA.");
  const blocked = await createdSearch("kopi susu", "Cilandak");
  const waiting = await createdSearch("bakso", "Cilandak");
  await waitUntilSettled(blocked.id);

  source.returns([kopiTuku]);
  const res = await resumeSearch(blocked.id);

  expect(res.status).toBe(200);
  expect(await waitUntilSettled(blocked.id)).toMatchObject({
    status: "done",
    reason: null,
    placeCount: 1,
  });
  expect(await waitUntilSettled(waiting.id)).toMatchObject({ status: "done" });
  expect(source.searchedTexts).toEqual([
    queryFor("kopi susu"),
    queryFor("kopi susu"),
    queryFor("bakso"),
  ]);
});

test("only a paused search can be resumed", async () => {
  source.returns([kopiTuku]);
  const done = await runSearch("kopi susu", "Cilandak");

  const res = await resumeSearch(done.id);

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: expect.any(String) });
  expect((await resumeSearch(999)).status).toBe(404);
  expect(source.searchedTexts).toEqual([queryFor("kopi susu")]);
});

test("a search cut off by closing the app is paused on reopening and continues when resumed", async () => {
  const release = source.holds();
  const interrupted = await createdSearch("kopi susu", "Cilandak");
  const waiting = await createdSearch("bakso", "Cilandak");
  await waitUntilRunning(interrupted.id);

  app.close();
  release();
  app = openApp();
  source.returns([kopiTuku]);

  expect(await fetchSearch(interrupted.id)).toMatchObject({
    status: "paused",
    reason: expect.stringContaining("aplikasi ditutup"),
  });
  await queueHadTimeToMove();
  expect(await fetchSearch(waiting.id)).toMatchObject({ status: "queued" });
  expect(source.searchedTexts).toEqual([queryFor("kopi susu")]);

  await resumeSearch(interrupted.id);

  expect(await waitUntilSettled(interrupted.id)).toMatchObject({ status: "done", placeCount: 1 });
  expect(await waitUntilSettled(waiting.id)).toMatchObject({ status: "done" });
  expect(source.searchedTexts).toEqual([
    queryFor("kopi susu"),
    queryFor("kopi susu"),
    queryFor("bakso"),
  ]);
});

test("a search paused by a block is still paused with its reason after reopening the app", async () => {
  source.blocks("Google Maps menampilkan CAPTCHA.");
  const blocked = await runSearch("kopi susu", "Cilandak");

  app.close();
  app = openApp();

  expect(await fetchSearch(blocked.id)).toMatchObject({
    status: "paused",
    reason: "Google Maps menampilkan CAPTCHA.",
  });
});
