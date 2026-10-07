import { DatabaseSync } from "node:sqlite";
import type { PlaceResult } from "./google-maps-source/types.ts";

export type SearchStatus = "running" | "done" | "failed";

// A search ("Penelusuran" in CONTEXT.md).
export interface Search {
  id: number;
  keyword: string;
  region: string;
  status: SearchStatus;
  failureReason: string | null;
  createdAt: string;
  placeCount: number;
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

// The columns the place list can be sorted by, named as in ListedPlace.
const SORT_EXPRESSIONS = {
  name: "s.name COLLATE NOCASE",
  rating: "s.rating",
  reviewCount: "s.review_count",
  categoryLabel: "s.category_label COLLATE NOCASE",
  address: "s.address COLLATE NOCASE",
  snapshotDate: "s.taken_at",
};

export type SortColumn = keyof typeof SORT_EXPRESSIONS;

export const SORT_COLUMNS = Object.keys(SORT_EXPRESSIONS) as SortColumn[];

// Which places to list, and in what order. Filters combine: a place must pass
// all of them.
export interface PlaceQuery {
  // Places without a value in the column come last in both directions.
  sort?: { column: SortColumn; descending: boolean };
  // Only places found by this search.
  searchId?: number;
  // Only places whose category label is one of these.
  categoryLabels?: string[];
  minRating?: number;
  minReviewCount?: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS search (
    id INTEGER PRIMARY KEY,
    keyword TEXT NOT NULL,
    region TEXT NOT NULL,
    status TEXT NOT NULL,
    failure_reason TEXT,
    created_at TEXT NOT NULL
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

// Each place with its latest snapshot.
const FROM_PLACE_WITH_LATEST_SNAPSHOT = `
  FROM place p
  JOIN snapshot s ON s.id = (SELECT MAX(id) FROM snapshot WHERE place_id = p.id)`;

const SELECT_SEARCH = `
  SELECT s.*, (SELECT COUNT(*) FROM search_place sp WHERE sp.search_id = s.id) AS place_count
  FROM search s`;

function toSearch(row: Record<string, any>): Search {
  return {
    id: row.id,
    keyword: row.keyword,
    region: row.region,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    placeCount: row.place_count,
  };
}

export class Storage {
  #db: DatabaseSync;

  constructor(databaseFile: string) {
    this.#db = new DatabaseSync(databaseFile);
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec(SCHEMA);
  }

  close(): void {
    this.#db.close();
  }

  createSearch(keyword: string, region: string, time: Date): number {
    const { lastInsertRowid } = this.#db
      .prepare(
        "INSERT INTO search (keyword, region, status, created_at) VALUES (?, ?, 'running', ?)",
      )
      .run(keyword, region, time.toISOString());
    return Number(lastInsertRowid);
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
      this.#db.prepare("UPDATE search SET status = 'done' WHERE id = ?").run(searchId);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  markFailed(searchId: number, reason: string): void {
    this.#db
      .prepare("UPDATE search SET status = 'failed', failure_reason = ? WHERE id = ?")
      .run(reason, searchId);
  }

  search(id: number): Search {
    const row = this.#db.prepare(`${SELECT_SEARCH} WHERE s.id = ?`).get(id) as Record<string, any>;
    return toSearch(row);
  }

  // Newest first.
  listSearches(): Search[] {
    const rows = this.#db.prepare(`${SELECT_SEARCH} ORDER BY s.id DESC`).all() as Record<
      string,
      any
    >[];
    return rows.map(toSearch);
  }

  // The distinct category labels in the latest snapshots, in alphabetical order.
  listCategoryLabels(): string[] {
    const rows = this.#db
      .prepare(
        `SELECT DISTINCT s.category_label
         ${FROM_PLACE_WITH_LATEST_SNAPSHOT}
         WHERE s.category_label IS NOT NULL
         ORDER BY s.category_label COLLATE NOCASE`,
      )
      .all() as { category_label: string }[];
    return rows.map((row) => row.category_label);
  }

  // Each place is listed with its latest snapshot.
  listPlaces(query: PlaceQuery = {}): ListedPlace[] {
    const conditions: string[] = [];
    const parameters: (string | number)[] = [];
    if (query.searchId !== undefined) {
      conditions.push(
        "EXISTS (SELECT 1 FROM search_place sp WHERE sp.place_id = p.id AND sp.search_id = ?)",
      );
      parameters.push(query.searchId);
    }
    if (query.categoryLabels !== undefined) {
      conditions.push(`s.category_label IN (${query.categoryLabels.map(() => "?").join(", ")})`);
      parameters.push(...query.categoryLabels);
    }
    if (query.minRating !== undefined) {
      conditions.push("s.rating >= ?");
      parameters.push(query.minRating);
    }
    if (query.minReviewCount !== undefined) {
      conditions.push("s.review_count >= ?");
      parameters.push(query.minReviewCount);
    }

    const order: string[] = [];
    if (query.sort) {
      const expression = SORT_EXPRESSIONS[query.sort.column];
      order.push(`${expression} IS NULL`, `${expression} ${query.sort.descending ? "DESC" : "ASC"}`);
    }
    order.push("p.id");

    const rows = this.#db
      .prepare(
        `SELECT p.google_id, s.place_id, s.taken_at, s.name, s.rating, s.review_count,
                s.category_label, s.address, s.lat, s.lng, s.cover_photo
         ${FROM_PLACE_WITH_LATEST_SNAPSHOT}
         ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY ${order.join(", ")}`,
      )
      .all(...parameters) as Record<string, any>[];
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
