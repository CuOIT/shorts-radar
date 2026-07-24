import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { MANUAL_TAG_FIELDS, QUOTA } from '../src/config.js';
import { runScan } from '../src/pipeline.js';
import { createQuotaGuard } from '../src/quota.js';
import {
  createFixtureClient,
  EXPECTED_ORDER,
  EXPECTED_QUOTA_SPEND,
  EXPECTED_ROW_COUNT,
  FIXTURE_NOW,
  FIXTURE_SEEDS,
} from './fixtures/index.js';

const silent = { log() {}, warn() {}, error() {} };

/**
 * Every test in this file runs with global fetch replaced by a landmine.
 * If the pipeline ever reaches for the network, the test fails instead of
 * quietly hitting the real API and burning quota.
 */
let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('network call attempted during an offline test');
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function run(overrides = {}) {
  const client = await createFixtureClient();
  const quota = createQuotaGuard({ logger: silent });
  const result = await runScan({
    client,
    quota,
    now: FIXTURE_NOW,
    seeds: FIXTURE_SEEDS,
    logger: silent,
    ...overrides,
  });
  return { ...result, client, quota };
}

describe('runScan against offline fixtures', () => {
  it('produces exactly the expected row count', async () => {
    const { records } = await run();
    assert.equal(records.length, EXPECTED_ROW_COUNT);
  });

  it('makes zero network calls and batches the API calls it does make', async () => {
    const { client } = await run();
    assert.deepEqual(client.calls, { search: 2, videos: 1, channels: 1 });
  });

  it('sorts by score, highest first', async () => {
    const { records } = await run();
    assert.deepEqual(
      records.map((record) => record.videoId),
      EXPECTED_ORDER,
    );
  });

  it('rejects each candidate for the right reason', async () => {
    const { stats } = await run();

    assert.equal(stats.candidates, 8, 'the duplicate across two seeds is counted once');
    assert.equal(stats.rejectedDuration, 1, 'the 3m12s video is not a Short');
    assert.equal(stats.rejectedViews, 1, 'the 12k-view video is noise');
    assert.equal(stats.rejectedSubs, 3, 'too big, too small, and one hidden count');
    assert.equal(stats.newRecords, EXPECTED_ROW_COUNT);
  });

  it('attributes a video to the first seed that surfaced it', async () => {
    const { records } = await run();
    const shared = records.find((record) => record.videoId === 'vid_pass_1');
    assert.equal(shared.seed, 'satisfying process');
  });

  it('writes complete records with empty manual tag columns', async () => {
    const { records } = await run();
    const record = records.find((r) => r.videoId === 'vid_pass_1');

    assert.equal(record.url, 'https://www.youtube.com/shorts/vid_pass_1');
    assert.equal(record.channelTitle, 'Grain & Resin');
    assert.equal(record.durationSec, 32);
    assert.equal(record.views, 420_000);
    assert.equal(record.subs, 12_000);
    assert.equal(record.outlier, 35);
    assert.equal(record.firstSeenAt, FIXTURE_NOW.toISOString());
    assert.ok(record.thumbnail.startsWith('https://'));

    for (const field of MANUAL_TAG_FIELDS) {
      assert.equal(record[field], '', `${field} must start empty`);
    }
  });

  it('spends the quota it is supposed to spend', async () => {
    const { stats } = await run();
    assert.equal(stats.quotaSpent, EXPECTED_QUOTA_SPEND);
    assert.equal(stats.quotaTripped, false);
  });

  it('skips videos already present in the data file', async () => {
    const { records, stats } = await run({ existingIds: new Set(['vid_pass_1', 'vid_pass_2']) });

    assert.equal(records.length, 1);
    assert.equal(records[0].videoId, 'vid_pass_3');
    assert.equal(stats.duplicates, 2);
  });
});

describe('quota guard', () => {
  it('stops before the next search and exits cleanly instead of throwing', async () => {
    // Enough headroom for one search only: 8000 + 100 <= 8000 is false at the second.
    const quota = createQuotaGuard({ spent: 7_900, logger: silent });
    const client = await createFixtureClient();

    const { records, stats } = await runScan({
      client,
      quota,
      now: FIXTURE_NOW,
      seeds: FIXTURE_SEEDS,
      logger: silent,
    });

    assert.equal(client.calls.search, 1, 'only the first seed fits under the guard');
    assert.equal(stats.seedsScanned, 1);
    assert.equal(stats.seedsSkipped, 1);
    assert.equal(stats.candidates, 5, 'the one search that ran still produced candidates');
    assert.equal(stats.quotaTripped, true);
    // The guard also blocks the follow-up videos.list, so this run banks nothing.
    // The point is that it returns instead of throwing.
    assert.equal(records.length, stats.newRecords);
    assert.equal(client.calls.videos, 0);
  });

  it('returns no records at all when the guard trips before the first search', async () => {
    const quota = createQuotaGuard({ spent: QUOTA.DAILY_BUDGET, logger: silent });
    const client = await createFixtureClient();

    const { records, stats } = await runScan({
      client,
      quota,
      now: FIXTURE_NOW,
      seeds: FIXTURE_SEEDS,
      logger: silent,
    });

    assert.equal(client.calls.search, 0);
    assert.equal(records.length, 0);
    assert.equal(stats.quotaTripped, true);
  });
});
