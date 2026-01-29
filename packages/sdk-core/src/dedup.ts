/**
 * Request deduplication utility
 *
 * Prevents multiple identical requests from being made simultaneously.
 */
export class RequestDeduplicator {
  private inflight: Map<string, Promise<unknown>> = new Map();

  /**
   * Execute a function with deduplication
   */
  async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Check if a request is in-flight
   */
  isInflight(key: string): boolean {
    return this.inflight.has(key);
  }

  /**
   * Clear all tracking
   */
  clear(): void {
    this.inflight.clear();
  }
}
