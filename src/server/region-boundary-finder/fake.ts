import type { RegionBoundaryFinder, RegionCandidate } from "./types.ts";

export class FakeRegionBoundaryFinder implements RegionBoundaryFinder {
  readonly lookedUpNames: string[] = [];
  #regions: RegionCandidate[] = [];
  #error: Error | null = null;

  knows(...regions: RegionCandidate[]): void {
    this.#regions = regions;
    this.#error = null;
  }

  fails(message: string): void {
    this.#error = new Error(message);
  }

  async findRegions(name: string): Promise<RegionCandidate[]> {
    this.lookedUpNames.push(name);
    if (this.#error) throw this.#error;
    return this.#regions.filter((region) =>
      region.name.toLowerCase().includes(name.toLowerCase()),
    );
  }
}
