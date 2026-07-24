import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hoursSincePublish, scoreVideo } from '../src/score.js';

const NOW = new Date('2026-07-24T12:00:00Z');

describe('hoursSincePublish', () => {
  it('measures elapsed hours', () => {
    assert.equal(hoursSincePublish('2026-07-24T00:00:00Z', NOW), 12);
    assert.equal(hoursSincePublish('2026-07-22T12:00:00Z', NOW), 48);
  });

  it('floors at one hour so brand-new uploads cannot divide by ~zero', () => {
    assert.equal(hoursSincePublish('2026-07-24T11:59:00Z', NOW), 1);
    assert.equal(hoursSincePublish('2026-07-24T13:00:00Z', NOW), 1);
  });

  it('falls back to one hour on an unparseable timestamp', () => {
    assert.equal(hoursSincePublish('nonsense', NOW), 1);
  });
});

describe('scoreVideo', () => {
  it('computes outlier, vph and score', () => {
    const result = scoreVideo(
      { views: 420_000, subs: 12_000, publishedAt: '2026-07-22T12:00:00Z' },
      NOW,
    );

    assert.equal(result.outlier, 35);
    assert.equal(result.vph, 8750);
    // 35 * log10(8760) = 137.988...
    assert.ok(Math.abs(result.score - 137.988) < 0.01, `score was ${result.score}`);
  });

  it('floors the subscriber denominator at 500', () => {
    const tiny = scoreVideo({ views: 50_000, subs: 100, publishedAt: '2026-07-24T02:00:00Z' }, NOW);
    const atFloor = scoreVideo(
      { views: 50_000, subs: 500, publishedAt: '2026-07-24T02:00:00Z' },
      NOW,
    );

    assert.equal(tiny.outlier, 100);
    assert.deepEqual(tiny, atFloor);
  });

  it('rewards overperformance relative to channel size, not raw views', () => {
    const publishedAt = '2026-07-23T12:00:00Z';
    const smallChannel = scoreVideo({ views: 500_000, subs: 10_000, publishedAt }, NOW);
    const hugeChannel = scoreVideo({ views: 500_000, subs: 5_000_000, publishedAt }, NOW);

    assert.ok(
      smallChannel.score > hugeChannel.score * 100,
      `expected the small channel to dominate: ${smallChannel.score} vs ${hugeChannel.score}`,
    );
  });

  it('prefers the faster climb when the outlier ratio is identical', () => {
    const fast = scoreVideo({ views: 100_000, subs: 10_000, publishedAt: '2026-07-24T02:00:00Z' }, NOW);
    const slow = scoreVideo({ views: 100_000, subs: 10_000, publishedAt: '2026-07-18T02:00:00Z' }, NOW);

    assert.equal(fast.outlier, slow.outlier);
    assert.ok(fast.score > slow.score);
  });

  it('never returns a negative or non-finite score', () => {
    const zeroViews = scoreVideo({ views: 0, subs: 1000, publishedAt: '2026-07-24T00:00:00Z' }, NOW);
    assert.equal(zeroViews.score, 0);
    assert.ok(Number.isFinite(zeroViews.score));
  });
});
