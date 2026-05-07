export interface CacheEntry {
  content: string;
  sha: string;
  timestamp: number;
}

export class Cache {
  private store: Map<string, CacheEntry> = new Map();
  private ttl: number = 60 * 1000; // 60 seconds

  get(path: string): CacheEntry | null {
    const entry = this.store.get(path);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttl) {
      this.store.delete(path);
      return null;
    }

    return entry;
  }

  set(path: string, content: string, sha: string): void {
    this.store.set(path, { content, sha, timestamp: Date.now() });
  }

  delete(path: string): void {
    this.store.delete(path);
  }

  clear(): void {
    this.store.clear();
  }

  has(path: string): boolean {
    return this.get(path) !== null;
  }
}
