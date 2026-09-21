/**
 * @author Codex
 * @description Verifies bounded, reachable page links for large catalogs and progressively discovered pages.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { listPaginationPages } from '../src/components/list-pagination-pages.ts';

test('page links retain the current page and boundaries without duplicate or unreachable numbers', () => {
  for (const total of [1, 2, 5, 6, 10, 50, 50000]) {
    for (const page of new Set([1, Math.ceil(total / 2), total])) {
      const items = listPaginationPages(page, total);
      const numbers = items.filter((item) => typeof item === 'number');
      assert.ok(items.length <= 5);
      assert.ok(numbers.includes(page));
      assert.equal(numbers[0], 1);
      assert.equal(numbers.at(-1), total);
      assert.deepEqual(
        numbers,
        [...new Set(numbers)].sort((a, b) => a - b)
      );
      assert.ok(numbers.every((item) => item >= 1 && item <= total));
    }
  }
});

test('cursor discovery exposes only visited pages and the confirmed next page', () => {
  for (let page = 1; page <= 20; page++) {
    for (const hasMore of [false, true]) {
      const items = listPaginationPages(page, page + Number(hasMore));
      assert.ok(items.includes(page));
      assert.equal(items.includes(page + 1), hasMore);
      assert.ok(items.every((item) => typeof item !== 'number' || item <= page + Number(hasMore)));
    }
  }
});
