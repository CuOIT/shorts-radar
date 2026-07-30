import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { daysSincePublish, median, scoreLongform } from '../src/longform/score.js';

const NOW = new Date('2026-07-30T12:00:00Z');

describe('median', () => {
  it('returns the middle value for an odd-length list', () => {
    assert.equal(median([40_000, 60_000, 50_000]), 50_000);
  });

  it('averages the two middle values for an even-length list', () => {
    assert.equal(median([200_000, 260_000, 220_000, 240_000]), 230_000);
  });

  it('returns 0 for an empty list rather than NaN', () => {
    assert.equal(median([]), 0);
  });

  it('handles a list of zeros without dividing by anything', () => {
    assert.equal(median([0, 0, 0]), 0);
  });

  it('ignores non-finite entries', () => {
    assert.equal(median([10, NaN, 20, undefined, 30]), 20);
  });

  it('does not mutate the caller array', () => {
    const input = [3, 1, 2];
    median(input);
    assert.deepEqual(input, [3, 1, 2]);
  });
});

describe('daysSincePublish', () => {
  it('measures elapsed days', () => {
    assert.equal(daysSincePublish('2026-07-20T12:00:00Z', NOW), 10);
  });

  it('floors at one day so a same-day upload cannot divide by ~zero', () => {
    assert.equal(daysSincePublish('2026-07-30T11:00:00Z', NOW), 1);
    assert.equal(daysSincePublish('2026-08-01T00:00:00Z', NOW), 1);
  });

  it('falls back to one day on an unparseable timestamp', () => {
    assert.equal(daysSincePublish('nonsense', NOW), 1);
  });
});

describe('scoreLongform', () => {
  it('computes lift against the channel median', () => {
    const result = scoreLongform(
      { views: 820_000, channelMedian: 50_000, publishedAt: '2026-07-20T12:00:00Z' },
      NOW,
    );

    assert.equal(result.lift, 16.4);
    assert.equal(result.vpd, 82_000);
  });

  it('floors the median denominator so a new channel cannot invent a huge lift', () => {
    const zeroMedian = scoreLongform(
      { views: 50_000, channelMedian: 0, publishedAt: '2026-07-25T12:00:00Z' },
      NOW,
    );
    const flooredMedian = scoreLongform(
      { views: 50_000, channelMedian: 1_000, publishedAt: '2026-07-25T12:00:00Z' },
      NOW,
    );

    assert.equal(zeroMedian.lift, 50);
    assert.deepEqual(zeroMedian, flooredMedian);
    assert.ok(Number.isFinite(zeroMedian.score));
  });

  it('ranks a breakout episode above a routine one from a bigger channel', () => {
    const publishedAt = '2026-07-20T12:00:00Z';
    const breakout = scoreLongform({ views: 820_000, channelMedian: 50_000, publishedAt }, NOW);
    const routine = scoreLongform({ views: 260_000, channelMedian: 230_000, publishedAt }, NOW);

    assert.ok(
      breakout.score > routine.score,
      `breakout ${breakout.score} should beat routine ${routine.score}`,
    );
  });

  it('prefers the faster climb when lift is identical', () => {
    const fast = scoreLongform(
      { views: 100_000, channelMedian: 50_000, publishedAt: '2026-07-28T12:00:00Z' },
      NOW,
    );
    const slow = scoreLongform(
      { views: 100_000, channelMedian: 50_000, publishedAt: '2026-06-01T12:00:00Z' },
      NOW,
    );

    assert.equal(fast.lift, slow.lift);
    assert.ok(fast.score > slow.score);
  });

  it('never returns a non-finite score', () => {
    const zeroViews = scoreLongform(
      { views: 0, channelMedian: 0, publishedAt: '2026-07-30T00:00:00Z' },
      NOW,
    );
    assert.equal(zeroViews.score, 0);
    assert.ok(Number.isFinite(zeroViews.score));
  });
});
