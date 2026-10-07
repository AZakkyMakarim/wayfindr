import { expect, vi } from "vitest";
import type { App } from "../src/server/app.ts";

// Searches run from the fetch queue after the request that created them has
// returned, so tests wait for the status they need.

export async function fetchSearch(app: App, id: number): Promise<any> {
  const res = await app.request(`/api/searches/${id}`);
  expect(res.status).toBe(200);
  return res.json();
}

// Waits until the queue has stopped working on the search, then returns it.
export function waitUntilSettled(app: App, id: number): Promise<any> {
  return vi.waitFor(
    async () => {
      const search = await fetchSearch(app, id);
      expect(["queued", "running"]).not.toContain(search.status);
      return search;
    },
    { interval: 5 },
  );
}

export function waitUntilRunning(app: App, id: number): Promise<void> {
  return vi.waitFor(
    async () => expect(await fetchSearch(app, id)).toMatchObject({ status: "running" }),
    { interval: 5 },
  );
}
