export class SpriteManager {
  private cache = new Map<string, HTMLCanvasElement>();

  has(itemId: string): boolean {
    return this.cache.has(itemId);
  }

  /**
   * Rasterizes a 256-element pixel array onto a 16×16 off-screen canvas exactly once.
   * Null, empty, and fully-transparent (#00000000) pixels are skipped — the void is respected.
   * Idempotent: subsequent calls for the same itemId are no-ops.
   */
  bake(itemId: string, pixels: (string | null)[]): void {
    if (this.cache.has(itemId)) return;
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      if (!px || px === "#00000000") continue;
      ctx.fillStyle = px;
      ctx.fillRect(i % 16, Math.floor(i / 16), 1, 1);
    }
    this.cache.set(itemId, canvas);
  }

  get(itemId: string): HTMLCanvasElement | undefined {
    return this.cache.get(itemId);
  }

  /**
   * Releases canvases for every item ID not present in activeItemIds.
   * Call once per ENGINE_TICK after the vision refetch resolves.
   * Pass the union of ground-visible IDs and the player's held inventory IDs
   * so carried items are never evicted prematurely.
   */
  prune(activeItemIds: Set<string>): void {
    for (const key of Array.from(this.cache.keys())) {
      if (!activeItemIds.has(key)) this.cache.delete(key);
    }
  }
}

export const spriteManager = new SpriteManager();
