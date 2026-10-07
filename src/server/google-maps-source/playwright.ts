import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { CoverPhoto, FindPlacesResult, GoogleMapsSource, PlaceResult } from "./types.ts";

// Everything that knows the shape of Google Maps pages (Indonesian UI) lives in
// this file. When Google changes the page, this is the only file to fix; check
// it with `npm run try-source`.

const FEED_SELECTOR = 'div[role="feed"]';
const CARD_SELECTOR = `${FEED_SELECTOR} div[role="article"]`;
const END_OF_LIST_TEXT = "Anda telah mencapai akhir daftar";
const NO_RESULTS_TEXT = "Google Maps tidak dapat menemukan";
const MAX_SCROLLS = 200;
const MAX_SCROLLS_WITHOUT_NEW_CARDS = 10;

// Raw content of one result card, read inside the page and parsed here.
interface RawCard {
  name: string | null;
  href: string | null;
  starsLabel: string | null;
  starsText: string | null;
  detailsLine: string | null;
  photoUrl: string | null;
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));
}

// Indonesian number format: "1.206" is 1206 and "4,8" is 4.8.
function parseIndonesianNumber(text: string): number {
  return Number(text.replaceAll(".", "").replace(",", "."));
}

function parseCard(card: RawCard): Omit<PlaceResult, "coverPhoto"> | null {
  // The place link carries the Google identity (!1s...) and position (!3d...!4d...).
  const link = card.href?.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+).*?!3d(-?[\d.]+)!4d(-?[\d.]+)/);
  if (!card.name || !link) return null;

  // Label example: "4,8 bintang 1.206 Ulasan", sometimes only "4,8 bintang";
  // visible text: "4,8(1.206)". A place without reviews has neither.
  const rating = card.starsLabel?.match(/^([\d,]+)\s+bintang/);
  const reviewCount =
    card.starsLabel?.match(/([\d.]+)\s+Ulasan/) ?? card.starsText?.match(/\(([\d.]+)\)/);

  // Line example: "Kedai Kopi · Jl. Keramat No.15, RT.7/RW.1"; the address can be absent.
  const parts = (card.detailsLine ?? "")
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  return {
    googleId: link[1]!,
    name: card.name,
    rating: rating ? parseIndonesianNumber(rating[1]!) : null,
    reviewCount: reviewCount ? parseIndonesianNumber(reviewCount[1]!) : null,
    categoryLabel: parts[0] ?? null,
    address: parts.length > 1 ? parts.at(-1)! : null,
    position: { lat: Number(link[2]), lng: Number(link[3]) },
  };
}

// The returned reason is shown to the user, so it is in Indonesian.
async function blockedReason(page: Page): Promise<string | null> {
  if (new URL(page.url()).pathname.startsWith("/sorry")) {
    return "Google meminta verifikasi CAPTCHA atau memblokir akses.";
  }
  if ((await page.locator('iframe[src*="recaptcha"]').count()) > 0) {
    return "Google Maps menampilkan CAPTCHA.";
  }
  return null;
}

function readCards(page: Page): Promise<RawCard[]> {
  return page.locator(CARD_SELECTOR).evaluateAll((cards) =>
    cards.map((card) => {
      const link = card.querySelector<HTMLAnchorElement>('a[href*="/maps/place/"]');
      const stars = card.querySelector<HTMLElement>('span[role="img"][aria-label*="bintang"]');
      // The details block is the only nested .W4Efsd; its first line holds the
      // category label and the address.
      const details = card.querySelector<HTMLElement>(".W4Efsd .W4Efsd");
      const photo = card.querySelector<HTMLImageElement>('img[src*="googleusercontent.com"]');
      return {
        name: link?.getAttribute("aria-label") ?? null,
        href: link?.href ?? null,
        starsLabel: stars?.getAttribute("aria-label") ?? null,
        starsText: stars?.innerText ?? null,
        detailsLine: details?.innerText ?? null,
        photoUrl: photo?.src ?? null,
      };
    }),
  );
}

// Keeps the most complete reading of each field: Google Maps sometimes strips
// the review count and the photo from cards that were scrolled far out of view.
function mergeCards(seen: Map<string, RawCard>, cards: RawCard[]): void {
  const longer = (a: string | null, b: string | null) =>
    (b?.length ?? 0) > (a?.length ?? 0) ? b : a;
  for (const card of cards) {
    if (!card.href) continue;
    const previous = seen.get(card.href);
    seen.set(
      card.href,
      previous
        ? {
            name: previous.name ?? card.name,
            href: card.href,
            starsLabel: longer(previous.starsLabel, card.starsLabel),
            starsText: longer(previous.starsText, card.starsText),
            detailsLine: longer(previous.detailsLine, card.detailsLine),
            photoUrl: previous.photoUrl ?? card.photoUrl,
          }
        : card,
    );
  }
}

// Scrolls the result list to its end, reading the cards at every step.
async function readAllCards(page: Page): Promise<RawCard[]> {
  const feed = page.locator(FEED_SELECTOR);
  const seen = new Map<string, RawCard>();
  let scrollsWithoutNewCards = 0;
  for (let i = 0; i < MAX_SCROLLS && scrollsWithoutNewCards < MAX_SCROLLS_WITHOUT_NEW_CARDS; i++) {
    const previousCount = seen.size;
    mergeCards(seen, await readCards(page));
    scrollsWithoutNewCards = seen.size > previousCount ? 0 : scrollsWithoutNewCards + 1;
    if ((await feed.getByText(END_OF_LIST_TEXT).count()) > 0) break;
    // Scroll up a little first: scrolling to the bottom while already there
    // does not trigger loading the next results.
    await feed.evaluate((element) => element.scrollBy(0, -400));
    await randomDelay(200, 500);
    await feed.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await randomDelay(1200, 2500);
  }
  return [...seen.values()];
}

async function downloadPhoto(context: BrowserContext, url: string | null): Promise<CoverPhoto | null> {
  if (!url) return null;
  // The URL suffix sets the photo size; ask for one large enough for the table.
  const mediumUrl = url.replace(/=w\d+-h\d+[^/]*$/, "=w400-h300-k-no");
  try {
    const response = await context.request.get(mediumUrl);
    if (!response.ok()) return null;
    const contentType = (response.headers()["content-type"] ?? "").split(";")[0]!.trim();
    return { contentType, data: new Uint8Array(await response.body()) };
  } catch {
    return null;
  }
}

export class PlaywrightGoogleMapsSource implements GoogleMapsSource {
  #browser: Browser | null = null;
  #page: Page | null = null;

  // One browser for the whole app, kept open between queries: the user solves
  // a CAPTCHA in this window, and the cookies that prove it must still be
  // there when the fetch is resumed. The system never touches the CAPTCHA.
  async #openPage(): Promise<Page> {
    if (this.#browser?.isConnected() && this.#page && !this.#page.isClosed()) return this.#page;
    await this.close();
    // Visible browser, not logged in (spec #1, "Perilaku pengambilan").
    this.#browser = await chromium.launch({ headless: false });
    const context = await this.#browser.newContext({
      locale: "id-ID",
      viewport: { width: 1280, height: 900 },
    });
    this.#page = await context.newPage();
    return this.#page;
  }

  async close(): Promise<void> {
    await this.#browser?.close().catch(() => {});
    this.#browser = null;
    this.#page = null;
  }

  async findPlaces(text: string): Promise<FindPlacesResult> {
    const page = await this.#openPage();
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(text)}?hl=id`, {
      waitUntil: "domcontentloaded",
    });

    const hasFeed = await page
      .waitForSelector(FEED_SELECTOR, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    const reason = await blockedReason(page);
    if (reason) return { kind: "blocked", reason };
    if (!hasFeed) {
      if ((await page.getByText(NO_RESULTS_TEXT).count()) > 0) {
        return { kind: "ok", places: [] };
      }
      throw new Error(`Google Maps tidak menampilkan daftar hasil untuk "${text}".`);
    }

    const cards = await readAllCards(page);
    const reasonAfterScroll = await blockedReason(page);
    if (reasonAfterScroll) return { kind: "blocked", reason: reasonAfterScroll };

    const places: PlaceResult[] = [];
    const seen = new Set<string>();
    for (const card of cards) {
      const parsed = parseCard(card);
      if (!parsed || seen.has(parsed.googleId)) continue;
      seen.add(parsed.googleId);
      await randomDelay(100, 300);
      places.push({ ...parsed, coverPhoto: await downloadPhoto(page.context(), card.photoUrl) });
    }
    return { kind: "ok", places };
  }
}
