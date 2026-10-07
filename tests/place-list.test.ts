import { expect, test } from "vitest";
import type { PlaceResult } from "../src/server/google-maps-source/types.ts";
import { kopiNako, kopiTuku } from "./fixtures.ts";
import { useTestApp } from "./harness.ts";

const t = useTestApp();

// High rating from a handful of reviews.
const kopiSudut: PlaceResult = {
  googleId: "0x2e69f1:0xccc3",
  name: "Kopi Sudut",
  rating: 4.9,
  reviewCount: 12,
  categoryLabel: "Kedai Kopi",
  address: "Jl. Antasari No.3",
  position: { lat: -6.2788, lng: 106.8101 },
  coverPhoto: null,
};

// Newly opened: Google Maps shows no rating, reviews, category label, or address yet.
const warungBaru: PlaceResult = {
  googleId: "0x2e69f1:0xddd4",
  name: "Warung Baru",
  rating: null,
  reviewCount: null,
  categoryLabel: null,
  address: null,
  position: { lat: -6.2755, lng: 106.8077 },
  coverPhoto: null,
};

async function names(query: string): Promise<string[]> {
  return (await t.listPlaces(query)).map((place) => place.name);
}

test("each place carries a link that opens it in Google Maps", async () => {
  t.source.returns([kopiTuku]);
  await t.runSearch("kopi susu", "Cilandak");

  // 0xaaa1, the second half of the Google identity, is 43681.
  expect(await t.listPlaces()).toMatchObject([
    { googleMapsUrl: "https://www.google.com/maps?cid=43681" },
  ]);
});

test("a place whose Google identity has an unknown shape is listed without a link", async () => {
  t.source.returns([{ ...kopiTuku, googleId: "ChIJ-unknown" }]);
  await t.runSearch("kopi susu", "Cilandak");

  expect(await t.listPlaces()).toMatchObject([{ name: "Toko Kopi Tuku", googleMapsUrl: null }]);
});

test("the category labels to filter by are listed once each, in alphabetical order", async () => {
  t.source.returns([kopiTuku, kopiNako, kopiSudut, warungBaru]);
  await t.runSearch("kopi susu", "Cilandak");

  const res = await t.app.request("/api/category-labels");

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(["Kafe", "Kedai Kopi"]);
});

test("a minimum rating keeps only places rated at least that high", async () => {
  t.source.returns([kopiTuku, kopiNako, kopiSudut, warungBaru]);
  await t.runSearch("kopi susu", "Cilandak");

  expect(await names("minRating=4.6")).toEqual(["Toko Kopi Tuku", "Kopi Sudut"]);
});

test("a minimum review count keeps only places with at least that many reviews", async () => {
  t.source.returns([kopiTuku, kopiNako, kopiSudut, warungBaru]);
  await t.runSearch("kopi susu", "Cilandak");

  expect(await names("minReviewCount=870")).toEqual(["Toko Kopi Tuku", "Kopi Nako"]);
});

test("a category label keeps only places with exactly that label", async () => {
  t.source.returns([kopiTuku, kopiNako, kopiSudut, warungBaru]);
  await t.runSearch("kopi susu", "Cilandak");

  expect(await names("category=Kedai+Kopi")).toEqual(["Toko Kopi Tuku", "Kopi Sudut"]);
});

test("several category labels keep places with any of them", async () => {
  t.source.returns([kopiTuku, kopiNako, kopiSudut, warungBaru]);
  await t.runSearch("kopi susu", "Cilandak");

  expect(await names("category=Kafe&category=Kedai+Kopi")).toEqual([
    "Toko Kopi Tuku",
    "Kopi Nako",
    "Kopi Sudut",
  ]);
});

test("a search keeps only the places that search found", async () => {
  t.source.returns([kopiTuku, kopiNako]);
  await t.runSearch("kopi susu", "Cilandak");
  t.source.returns([kopiTuku, kopiSudut]);
  const second = await t.runSearch("kedai kopi", "Cilandak");

  expect(await names(`search=${second.id}`)).toEqual(["Toko Kopi Tuku", "Kopi Sudut"]);
});

test("combined filters keep only places that pass every one of them", async () => {
  t.source.returns([kopiNako, warungBaru]);
  await t.runSearch("kopi susu", "Cilandak");
  t.source.returns([kopiTuku, kopiNako, kopiSudut]);
  const second = await t.runSearch("kedai kopi", "Cilandak");

  // Of the second search: Kopi Nako is a "Kafe", Kopi Sudut has too few reviews.
  expect(
    await names(`search=${second.id}&category=Kedai+Kopi&minRating=4.5&minReviewCount=100`),
  ).toEqual(["Toko Kopi Tuku"]);
});

test.each([
  ["rating", "asc", ["Kopi Nako", "Toko Kopi Tuku", "Kopi Sudut", "Warung Baru"]],
  ["rating", "desc", ["Kopi Sudut", "Toko Kopi Tuku", "Kopi Nako", "Warung Baru"]],
  ["reviewCount", "asc", ["Kopi Sudut", "Kopi Nako", "Toko Kopi Tuku", "Warung Baru"]],
  ["reviewCount", "desc", ["Toko Kopi Tuku", "Kopi Nako", "Kopi Sudut", "Warung Baru"]],
  ["categoryLabel", "asc", ["Kopi Nako", "Toko Kopi Tuku", "Kopi Sudut", "Warung Baru"]],
  ["categoryLabel", "desc", ["Toko Kopi Tuku", "Kopi Sudut", "Kopi Nako", "Warung Baru"]],
  ["address", "asc", ["Kopi Sudut", "Toko Kopi Tuku", "Kopi Nako", "Warung Baru"]],
  ["address", "desc", ["Kopi Nako", "Toko Kopi Tuku", "Kopi Sudut", "Warung Baru"]],
])(
  "sorting by %s %s puts the place without a value at the bottom",
  async (column, order, expected) => {
    t.source.returns([warungBaru, kopiTuku, kopiNako, kopiSudut]);
    await t.runSearch("kopi susu", "Cilandak");

    expect(await names(`sort=${column}&order=${order}`)).toEqual(expected);
  },
);

test("sorting is ascending unless descending is asked for", async () => {
  t.source.returns([kopiTuku, kopiNako, kopiSudut]);
  await t.runSearch("kopi susu", "Cilandak");

  expect(await names("sort=rating")).toEqual(["Kopi Nako", "Toko Kopi Tuku", "Kopi Sudut"]);
});

test("sorting by name ignores letter case", async () => {
  t.source.returns([kopiTuku, { ...kopiNako, name: "kopi nako" }, kopiSudut]);
  await t.runSearch("kopi susu", "Cilandak");

  expect(await names("sort=name")).toEqual(["kopi nako", "Kopi Sudut", "Toko Kopi Tuku"]);
});

test("sorting by snapshot date follows the latest snapshot of each place", async () => {
  t.source.returns([kopiTuku, kopiNako]);
  await t.runSearch("kopi susu", "Cilandak");
  t.now = new Date("2026-10-09T08:30:00.000Z");
  t.source.returns([kopiTuku, kopiSudut]);
  await t.runSearch("kedai kopi", "Cilandak");

  expect(await names("sort=snapshotDate&order=asc")).toEqual([
    "Kopi Nako",
    "Toko Kopi Tuku",
    "Kopi Sudut",
  ]);
});

test("sorting applies to the filtered list", async () => {
  t.source.returns([kopiTuku, kopiNako, kopiSudut, warungBaru]);
  await t.runSearch("kopi susu", "Cilandak");

  expect(await names("category=Kedai+Kopi&sort=rating&order=desc")).toEqual([
    "Kopi Sudut",
    "Toko Kopi Tuku",
  ]);
});

test.each([
  ["an unknown sort column", "sort=price"],
  ["an unknown sort order", "sort=rating&order=sideways"],
  ["a sort order without a sort column", "order=desc"],
  ["a minimum rating that is not a number", "minRating=bagus"],
  ["an empty minimum rating", "minRating="],
  ["a minimum review count that is not a whole number", "minReviewCount=1.5"],
  ["a search that is not a number", "search=kopi"],
])("a place list with %s is rejected", async (_case, query) => {
  const res = await t.app.request(`/api/places?${query}`);

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: expect.any(String) });
});
