import type { CoverPhoto, GoogleMapsSource } from "./google-maps-source/types.ts";
import { isInsideBoundary } from "./region.ts";
import type { Search, Storage } from "./storage.ts";

export interface FetchQueueOptions {
  source: GoogleMapsSource;
  storage: Storage;
  // Stores a cover photo and returns the name of its file.
  savePhoto(photo: CoverPhoto | null): string | null;
  now(): Date;
}

// Fetch queue ("Antrean pengambilan"): the only caller of the Google Maps
// source. It has one worker, so two fetches never run at the same time. The
// queue itself is the status of the searches in storage, which is why it
// survives closing the app.
export class FetchQueue {
  #options: FetchQueueOptions;
  #isWorking = false;
  #isStopped = false;

  constructor(options: FetchQueueOptions) {
    this.#options = options;
  }

  // Starts the worker unless it is already working. Call after a search is
  // queued or resumed; nothing else makes the queue move.
  wake(): void {
    if (this.#isWorking || this.#isStopped) return;
    this.#isWorking = true;
    this.#work().catch((error) => console.error("The fetch queue stopped unexpectedly:", error));
  }

  // Stops the worker for good. The search it is working on stays "running" in
  // storage, to be found as interrupted when the app is opened again.
  stop(): void {
    this.#isStopped = true;
  }

  async #work(): Promise<void> {
    const { storage } = this.#options;
    try {
      while (!this.#isStopped) {
        const search = storage.nextSearchToRun();
        if (!search) return;
        storage.markRunning(search.id);
        await this.#run(search);
      }
    } finally {
      this.#isWorking = false;
    }
  }

  async #run(search: Search): Promise<void> {
    const { source, storage, savePhoto, now } = this.#options;
    const { description, boundary } = storage.searchRegion(search.id);
    try {
      // The description tells Google Maps which of the same-named regions is meant.
      const result = await source.findPlaces(`${search.keyword} ${description}`);
      if (this.#isStopped) return;
      if (result.kind === "blocked") {
        storage.markPaused(search.id, result.reason);
      } else {
        storage.saveResults(
          search.id,
          result.places
            .filter((place) => !boundary || isInsideBoundary(place.position, boundary))
            .map((place) => ({ place, coverPhoto: savePhoto(place.coverPhoto) })),
          now(),
        );
      }
    } catch (error) {
      if (this.#isStopped) return;
      storage.markFailed(search.id, error instanceof Error ? error.message : String(error));
    }
  }
}
