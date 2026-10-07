import type { FindPlacesResult, GoogleMapsSource, PlaceResult } from "./types.ts";

export class FakeGoogleMapsSource implements GoogleMapsSource {
  readonly searchedTexts: string[] = [];
  #result: FindPlacesResult = { kind: "ok", places: [] };
  #error: Error | null = null;
  #hold: Promise<void> | null = null;

  returns(places: PlaceResult[]): void {
    this.#result = { kind: "ok", places };
    this.#error = null;
  }

  blocks(reason: string): void {
    this.#result = { kind: "blocked", reason };
    this.#error = null;
  }

  fails(message: string): void {
    this.#error = new Error(message);
  }

  // Makes queries wait, as a slow Google Maps would, until the returned
  // function is called.
  holds(): () => void {
    let release!: () => void;
    this.#hold = new Promise((resolve) => (release = resolve));
    return () => {
      this.#hold = null;
      release();
    };
  }

  async findPlaces(text: string): Promise<FindPlacesResult> {
    this.searchedTexts.push(text);
    await this.#hold;
    if (this.#error) throw this.#error;
    return this.#result;
  }
}
