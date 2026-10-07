import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import type { CoverPhoto, GoogleMapsSource } from "./google-maps-source/types.ts";
import { Storage } from "./storage.ts";

export interface AppOptions {
  source: GoogleMapsSource;
  databaseFile: string;
  photoDir: string;
  now?: () => Date;
}

export interface App {
  hono: Hono;
  request: Hono["request"];
  close(): void;
}

const PHOTO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const PHOTO_CONTENT_TYPES = Object.fromEntries(
  Object.entries(PHOTO_EXTENSIONS).map(([contentType, extension]) => [extension, contentType]),
);
const PHOTO_NAME_PATTERN = /^[0-9a-f]{64}\.(jpg|png|webp)$/;

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

export function createApp(options: AppOptions): App {
  const { source, photoDir } = options;
  const now = options.now ?? (() => new Date());
  const storage = new Storage(options.databaseFile);
  mkdirSync(photoDir, { recursive: true });
  const hono = new Hono();

  // The file name is derived from the content, so the same photo is never stored twice.
  function savePhoto(photo: CoverPhoto | null): string | null {
    if (!photo) return null;
    const extension = PHOTO_EXTENSIONS[photo.contentType];
    if (!extension) return null;
    const name = `${createHash("sha256").update(photo.data).digest("hex")}.${extension}`;
    const file = join(photoDir, name);
    if (!existsSync(file)) writeFileSync(file, photo.data);
    return name;
  }

  // Error messages and failure reasons are shown to the user, so they are in Indonesian.
  hono.post("/api/searches", async (c) => {
    const body = await c.req.json().catch(() => null);
    const keyword = nonEmptyText(body?.keyword);
    const region = nonEmptyText(body?.region);
    if (!keyword) return c.json({ error: "Kata Kunci wajib diisi." }, 400);
    if (!region) return c.json({ error: "Wilayah wajib diisi." }, 400);

    const id = storage.createSearch(keyword, region, now());
    try {
      const result = await source.findPlaces(`${keyword} ${region}`);
      if (result.kind === "blocked") {
        storage.markFailed(id, result.reason);
      } else {
        storage.saveResults(
          id,
          result.places.map((place) => ({ place, coverPhoto: savePhoto(place.coverPhoto) })),
          now(),
        );
      }
    } catch (error) {
      storage.markFailed(id, error instanceof Error ? error.message : String(error));
    }
    return c.json(storage.search(id), 201);
  });

  hono.get("/api/places", (c) =>
    c.json(
      storage.listPlaces().map((place) => ({
        ...place,
        coverPhoto: place.coverPhoto && `/api/photos/${place.coverPhoto}`,
      })),
    ),
  );

  hono.get("/api/photos/:name", (c) => {
    const name = c.req.param("name");
    const file = join(photoDir, name);
    if (!PHOTO_NAME_PATTERN.test(name) || !existsSync(file)) return c.notFound();
    const extension = name.slice(name.lastIndexOf(".") + 1);
    return c.body(readFileSync(file), 200, {
      "content-type": PHOTO_CONTENT_TYPES[extension]!,
      "cache-control": "public, max-age=31536000, immutable",
    });
  });

  return {
    hono,
    request: hono.request.bind(hono),
    close: () => storage.close(),
  };
}
