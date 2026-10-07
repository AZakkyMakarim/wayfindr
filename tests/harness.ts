import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect } from "vitest";
import { createApp, type App } from "../src/server/app.ts";
import { FakeGoogleMapsSource } from "../src/server/google-maps-source/fake.ts";

export interface TestApp {
  app: App;
  source: FakeGoogleMapsSource;
  // The time the app sees; assign to move the clock.
  now: Date;
  createSearch(keyword: unknown, region: unknown): Promise<Response>;
  // query is the query string of the place list, without the leading "?".
  listPlaces(query?: string): Promise<any[]>;
}

// Gives every test of the calling file a fresh app on a temporary database
// file and photo directory, behind a fake Google Maps source.
export function useTestApp(): TestApp {
  let dir: string;

  function openApp(): App {
    return createApp({
      source: t.source,
      databaseFile: join(dir, "wayfindr.db"),
      photoDir: join(dir, "photos"),
      now: () => t.now,
    });
  }

  const t: TestApp = {
    app: undefined as unknown as App,
    source: undefined as unknown as FakeGoogleMapsSource,
    now: new Date(0),
    async createSearch(keyword, region) {
      return t.app.request("/api/searches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword, region }),
      });
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
    t.now = new Date("2026-10-07T03:00:00.000Z");
    t.app = openApp();
  });

  afterEach(() => {
    t.app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  return t;
}
