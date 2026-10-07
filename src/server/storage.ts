import { DatabaseSync } from "node:sqlite";
import type { PlaceResult } from "./google-maps-source/types.ts";
import type { Boundary } from "./region-boundary-finder/types.ts";

export type SearchStatus = "queued" | "running" | "paused" | "done" | "failed";

// A search ("Penelusuran" in CONTEXT.md).
export interface Search {
  id: number;
  keyword: string;
  region: string;
  status: SearchStatus;
  // Why the search is paused or failed.
  reason: string | null;
  createdAt: string;
  placeCount: number;
}

// The region of a search: its name, the description that tells Google Maps
// which of the same-named regions is meant, and the boundary results must be inside.
export interface SearchRegion {
  name: string;
  description: string;
  boundary: Boundary | null;
}

export interface ListedPlace {
  id: number;
  googleId: string;
  name: string;
  rating: number | null;
  reviewCount: number | null;
  categoryLabel: string | null;
  address: string | null;
  position: { lat: number; lng: number };
  coverPhoto: string | null;
  snapshotDate: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS search (
    id INTEGER PRIMARY KEY,
    keyword TEXT NOT NULL,
    region TEXT NOT NULL,
    status TEXT NOT NULL,
    status_reason TEXT,
    created_at TEXT NOT NULL,
    region_description TEXT,
    region_boundary TEXT
  );
  CREATE TABLE IF NOT EXISTS place (
    id INTEGER PRIMARY KEY,
    google_id TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS search_place (
    search_id INTEGER NOT NULL REFERENCES search(id),
    place_id INTEGER NOT NULL REFERENCES place(id),
    PRIMARY KEY (search_id, place_id)
  );
  CREATE TABLE IF NOT EXISTS snapshot (
    id INTEGER PRIMARY KEY,
    place_id INTEGER NOT NULL REFERENCES place(id),
    taken_at TEXT NOT NULL,
    name TEXT NOT NULL,
    rating REAL,
    review_count INTEGER,
    category_label TEXT,
    address TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    cover_photo TEXT
  );
  CREATE INDEX IF NOT EXISTS snapshot_by_place ON snapshot(place_id, id);
`;

export class Storage {
  #db: DatabaseSync;

  constructor(databaseFile: string) {
    this.#db = new DatabaseSync(databaseFile);
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec(SCHEMA);
    this.#migrate();
  }

  // Brings a database file made by an older version up to the schema above.
  #migrate(): void {
    const columns = this.#db.prepare("PRAGMA table_info(search)").all() as { name: string }[];
    if (columns.some((column) => column.name === "failure_reason")) {
      this.#db.exec("ALTER TABLE search RENAME COLUMN failure_reason TO status_reason");
    }
    if (!columns.some((column) => column.name === "region_description")) {
      this.#db.exec("ALTER TABLE search ADD COLUMN region_description TEXT");
      this.#db.exec("ALTER TABLE search ADD COLUMN region_boundary TEXT");
    }
  }

  close(): void {
    this.#db.close();
  }

  // The region is stored with the search because the search runs later, from
  // the queue, possibly after the app was closed and opened again.
  createSearch(keyword: string, region: SearchRegion, time: Date): number {
    const { lastInsertRowid } = this.#db
      .prepare(
        `INSERT INTO search (keyword, region, region_description, region_boundary, status, created_at)
         VALUES (?, ?, ?, ?, 'queued', ?)`,
      )
      .run(
        keyword,
        region.name,
        region.description,
        JSON.stringify(region.boundary),
        time.toISOString(),
      );
    return Number(lastInsertRowid);
  }

  // What a search needs to query Google Maps. Searches stored before regions
  // had boundaries have neither a description nor a boundary.
  searchRegion(searchId: number): SearchRegion {
    const row = this.#db
      .prepare("SELECT region, region_description, region_boundary FROM search WHERE id = ?")
      .get(searchId) as Record<string, any>;
    return {
      name: row.region,
      description: row.region_description ?? row.region,
      boundary: JSON.parse(row.region_boundary ?? "null"),
    };
  }

  // coverPhoto of each result is the name of an already stored file, not the photo itself.
  saveResults(
    searchId: number,
    results: { place: PlaceResult; coverPhoto: string | null }[],
    time: Date,
  ): void {
    const insertPlace = this.#db.prepare(
      "INSERT INTO place (google_id) VALUES (?) ON CONFLICT (google_id) DO NOTHING",
    );
    const findPlace = this.#db.prepare("SELECT id FROM place WHERE google_id = ?");
    const link = this.#db.prepare(
      "INSERT OR IGNORE INTO search_place (search_id, place_id) VALUES (?, ?)",
    );
    const insertSnapshot = this.#db.prepare(
      `INSERT INTO snapshot (place_id, taken_at, name, rating, review_count, category_label, address, lat, lng, cover_photo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.#db.exec("BEGIN");
    try {
      for (const { place, coverPhoto } of results) {
        insertPlace.run(place.googleId);
        const { id } = findPlace.get(place.googleId) as { id: number };
        link.run(searchId, id);
        insertSnapshot.run(
          id,
          time.toISOString(),
          place.name,
          place.rating,
          place.reviewCount,
          place.categoryLabel,
          place.address,
          place.position.lat,
          place.position.lng,
          coverPhoto,
        );
      }
      this.#setStatus(searchId, "done", null);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #setStatus(searchId: number, status: SearchStatus, reason: string | null): void {
    this.#db
      .prepare("UPDATE search SET status = ?, status_reason = ? WHERE id = ?")
      .run(status, reason, searchId);
  }

  markRunning(searchId: number): void {
    this.#setStatus(searchId, "running", null);
  }

  markPaused(searchId: number, reason: string): void {
    this.#setStatus(searchId, "paused", reason);
  }

  markFailed(searchId: number, reason: string): void {
    this.#setStatus(searchId, "failed", reason);
  }

  // Puts a paused search back in the queue. Returns false when it is not paused.
  resume(searchId: number): boolean {
    const { changes } = this.#db
      .prepare(
        "UPDATE search SET status = 'queued', status_reason = NULL WHERE id = ? AND status = 'paused'",
      )
      .run(searchId);
    return changes === 1;
  }

  // Pauses the search that was at the head of the queue when the app was last
  // closed, so that it only continues when the user resumes it.
  pauseInterrupted(reason: string): void {
    this.#db
      .prepare("UPDATE search SET status = 'paused', status_reason = ? WHERE status = 'running'")
      .run(reason);
    const next = this.nextSearchToRun();
    if (next) this.markPaused(next.id, reason);
  }

  // The oldest queued search, or null when nothing is queued or a paused
  // search is holding the queue.
  nextSearchToRun(): Search | null {
    const row = this.#db
      .prepare(
        `SELECT MIN(id) AS id FROM search
         WHERE status = 'queued' AND NOT EXISTS (SELECT 1 FROM search WHERE status = 'paused')`,
      )
      .get() as { id: number | null };
    return row.id === null ? null : this.search(row.id);
  }

  search(id: number): Search | null {
    return this.#searches("WHERE s.id = ?", id)[0] ?? null;
  }

  listSearches(): Search[] {
    return this.#searches("ORDER BY s.id");
  }

  #searches(clause: string, ...parameters: number[]): Search[] {
    const rows = this.#db
      .prepare(
        `SELECT s.id, s.keyword, s.region, s.status, s.status_reason, s.created_at,
                (SELECT COUNT(*) FROM search_place sp WHERE sp.search_id = s.id) AS place_count
         FROM search s ${clause}`,
      )
      .all(...parameters) as Record<string, any>[];
    return rows.map((row) => ({
      id: row.id,
      keyword: row.keyword,
      region: row.region,
      status: row.status,
      reason: row.status_reason,
      createdAt: row.created_at,
      placeCount: row.place_count,
    }));
  }

  // Each place is listed with its latest snapshot.
  listPlaces(): ListedPlace[] {
    const rows = this.#db
      .prepare(
        `SELECT p.google_id, s.place_id, s.taken_at, s.name, s.rating, s.review_count,
                s.category_label, s.address, s.lat, s.lng, s.cover_photo
         FROM place p
         JOIN snapshot s ON s.id = (SELECT MAX(id) FROM snapshot WHERE place_id = p.id)
         ORDER BY p.id`,
      )
      .all() as Record<string, any>[];
    return rows.map((row) => ({
      id: row.place_id,
      googleId: row.google_id,
      name: row.name,
      rating: row.rating,
      reviewCount: row.review_count,
      categoryLabel: row.category_label,
      address: row.address,
      position: { lat: row.lat, lng: row.lng },
      coverPhoto: row.cover_photo,
      snapshotDate: row.taken_at,
    }));
  }
}
