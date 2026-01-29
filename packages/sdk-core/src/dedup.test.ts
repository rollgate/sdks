import { describe, it, expect, vi } from 'vitest';
import { RequestDeduplicator } from './dedup';

describe('RequestDeduplicator', () => {
  describe('dedupe', () => {
    it('should execute function and return result', async () => {
      const dedup = new RequestDeduplicator();
      const fn = vi.fn().mockResolvedValue('result');

      const result = await dedup.dedupe('key', fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate concurrent identical requests', async () => {
      const dedup = new RequestDeduplicator();
      const fn = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve('result'), 100))
        );

      const promise1 = dedup.dedupe('key', fn);
      const promise2 = dedup.dedupe('key', fn);
      const promise3 = dedup.dedupe('key', fn);

      const results = await Promise.all([promise1, promise2, promise3]);

      expect(results).toEqual(['result', 'result', 'result']);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should allow new requests after previous completes', async () => {
      const dedup = new RequestDeduplicator();
      const fn = vi.fn().mockResolvedValue('result');

      await dedup.dedupe('key', fn);
      await dedup.dedupe('key', fn);

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should handle different keys independently', async () => {
      const dedup = new RequestDeduplicator();
      const fn1 = vi.fn().mockResolvedValue('result1');
      const fn2 = vi.fn().mockResolvedValue('result2');

      const results = await Promise.all([dedup.dedupe('key1', fn1), dedup.dedupe('key2', fn2)]);

      expect(results).toEqual(['result1', 'result2']);
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors to all callers', async () => {
      const dedup = new RequestDeduplicator();
      const error = new Error('test error');
      const fn = vi.fn().mockRejectedValue(error);

      const promise1 = dedup.dedupe('key', fn);
      const promise2 = dedup.dedupe('key', fn);

      await expect(promise1).rejects.toThrow('test error');
      await expect(promise2).rejects.toThrow('test error');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should clean up after error', async () => {
      const dedup = new RequestDeduplicator();
      const fn = vi.fn().mockRejectedValueOnce(new Error('error')).mockResolvedValue('success');

      await dedup.dedupe('key', fn).catch(() => {});
      const result = await dedup.dedupe('key', fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('isInflight', () => {
    it('should return true while request is in-flight', async () => {
      const dedup = new RequestDeduplicator();
      let resolve: (value: string) => void;
      const fn = vi.fn().mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      );

      const promise = dedup.dedupe('key', fn);

      expect(dedup.isInflight('key')).toBe(true);

      resolve!('result');
      await promise;

      expect(dedup.isInflight('key')).toBe(false);
    });

    it('should return false for unknown key', () => {
      const dedup = new RequestDeduplicator();
      expect(dedup.isInflight('unknown')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all in-flight tracking', () => {
      const dedup = new RequestDeduplicator();
      const fn = vi.fn().mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      dedup.dedupe('key1', fn);
      dedup.dedupe('key2', fn);

      expect(dedup.isInflight('key1')).toBe(true);
      expect(dedup.isInflight('key2')).toBe(true);

      dedup.clear();

      expect(dedup.isInflight('key1')).toBe(false);
      expect(dedup.isInflight('key2')).toBe(false);
    });
  });
});
