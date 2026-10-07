import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect } from "vitest";
import { createApp, type App } from "../src/server/app.ts";
import { FakeGoogleMapsSource } from "../src/server/google-maps-source/fake.ts";
import { FakeRegionBoundaryFinder } from "../src/server/region-boundary-finder/fake.ts";
import { cilandak } from "./fixtures.ts";
import { waitUntilSettled } from "./waiting.ts";

export interface TestApp {
  app: App;
  source: FakeGoogleMapsSource;
  // The time the app sees; assign to move the clock.
  now: Date;
  // Creates a search and waits until the queue has stopped working on it.
  runSearch(keyword: string, region: string): Promise<any>;
  // query is the query string of the place list, without the leading "?".
  listPlaces(query?: string): Promise<any[]>;
}

// Gives every test of the calling file a fresh app on a temporary database
// file and photo directory, behind a fake Google Maps source and a region
// boundary finder that knows Cilandak.
export function useTestApp(): TestApp {
  let dir: string;

  const t: TestApp = {
    app: undefined as unknown as App,
    source: undefined as unknown as FakeGoogleMapsSource,
    now: new Date(0),
    async runSearch(keyword, region) {
      const res = await t.app.request("/api/searches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword, region }),
      });
      expect(res.status).toBe(201);
      return waitUntilSettled(t.app, (await res.json()).id);
    },
    async listPlaces(query = "") {
      const res = await t.app.request(`/api/places?${query}`);
      expect(res.status).toBe(200);
      return res.json();
    },
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wayfindr-"));
    t.source = new FakeGoogleMapsSource();
    const regionBoundaryFinder = new FakeRegionBoundaryFinder();
    regionBoundaryFinder.knows(cilandak);
    t.now = new Date("2026-10-07T03:00:00.000Z");
    t.app = createApp({
      source: t.source,
      regionBoundaryFinder,
      databaseFile: join(dir, "wayfindr.db"),
      photoDir: join(dir, "photos"),
      now: () => t.now,
    });
  });

  afterEach(() => {
    t.app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  return t;
}
