import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";
import { PlaywrightGoogleMapsSource } from "./google-maps-source/playwright.ts";

const PORT = Number(process.env.PORT ?? 4321);
const dataDir = join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

const app = createApp({
  source: new PlaywrightGoogleMapsSource(),
  databaseFile: join(dataDir, "wayfindr.db"),
  photoDir: join(dataDir, "photos"),
});
app.hono.use("*", serveStatic({ root: "./dist/web" }));

serve({ fetch: app.hono.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  console.log(`Wayfindr berjalan di http://localhost:${PORT}`);
});
