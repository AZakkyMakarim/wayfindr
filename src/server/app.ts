import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { FetchQueue } from "./fetch-queue.ts";
import type { CoverPhoto, GoogleMapsSource } from "./google-maps-source/types.ts";
import type { RegionBoundaryFinder, RegionCandidate } from "./region-boundary-finder/types.ts";
import { ADMIN_LEVEL_LABELS, regionRejection } from "./region.ts";
import { Storage } from "./storage.ts";

export interface AppOptions {
  source: GoogleMapsSource;
  regionBoundaryFinder: RegionBoundaryFinder;
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

function regionLookupFailure(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `Batas Wilayah gagal dicari: ${reason}`;
}

export function createApp(options: AppOptions): App {
  const { source, regionBoundaryFinder, photoDir } = options;
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

  // Error messages and status reasons are shown to the user, so they are in Indonesian.
  // No fetch starts on its own (spec #1, story 18): whatever the last run left
  // unfinished waits for the user to resume it.
  storage.pauseInterrupted("Terputus karena aplikasi ditutup.");
  const queue = new FetchQueue({ source, storage, savePhoto, now });

  hono.post("/api/searches", async (c) => {
    const body = await c.req.json().catch(() => null);
    const keyword = nonEmptyText(body?.keyword);
    const regionName = nonEmptyText(body?.region);
    if (!keyword) return c.json({ error: "Kata Kunci wajib diisi." }, 400);
    if (!regionName) return c.json({ error: "Wilayah wajib diisi." }, 400);

    const regionId = nonEmptyText(body?.regionId);

    let candidates: RegionCandidate[];
    try {
      candidates = await regionBoundaryFinder.findRegions(regionName);
    } catch (error) {
      return c.json({ error: regionLookupFailure(error) }, 502);
    }
    if (candidates.length === 0) {
      return c.json({ error: `Tidak ada daerah bernama "${regionName}" di OpenStreetMap.` }, 400);
    }
    // The region is never guessed: with several matches the user has to pick one.
    if (!regionId && candidates.length > 1) {
      return c.json(
        { error: `Ada ${candidates.length} daerah bernama "${regionName}"; pilih salah satu.` },
        400,
      );
    }
    const region = regionId
      ? candidates.find((candidate) => candidate.id === regionId)
      : candidates[0];
    if (!region) {
      return c.json(
        { error: `Wilayah yang dipilih tidak ada di antara daerah bernama "${regionName}".` },
        400,
      );
    }
    const rejection = regionRejection(region);
    if (rejection) return c.json({ error: rejection }, 400);

    const search = storage.search(storage.createSearch(keyword, region, now()));
    queue.wake();
    return c.json(search, 201);
  });

  hono.get("/api/searches", (c) => c.json(storage.listSearches()));

  hono.get("/api/searches/:id", (c) => {
    const search = storage.search(Number(c.req.param("id")));
    return search ? c.json(search) : c.notFound();
  });

  hono.post("/api/searches/:id/resume", (c) => {
    const id = Number(c.req.param("id"));
    if (!storage.search(id)) return c.notFound();
    if (!storage.resume(id)) {
      return c.json({ error: "Hanya Penelusuran yang terjeda yang bisa dilanjutkan." }, 409);
    }
    queue.wake();
    return c.json(storage.search(id));
  });

  hono.get("/api/regions", async (c) => {
    const name = nonEmptyText(c.req.query("name"));
    if (!name) return c.json({ error: "Nama Wilayah wajib diisi." }, 400);
    let candidates: RegionCandidate[];
    try {
      candidates = await regionBoundaryFinder.findRegions(name);
    } catch (error) {
      return c.json({ error: regionLookupFailure(error) }, 502);
    }
    return c.json(
      candidates.map((candidate) => ({
        ...candidate,
        adminLevelLabel: ADMIN_LEVEL_LABELS[candidate.adminLevel],
        rejection: regionRejection(candidate),
      })),
    );
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
    close: () => {
      queue.stop();
      storage.close();
    },
  };
}
