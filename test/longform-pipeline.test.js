import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { QUOTA } from '../src/config.js';
import { MANUAL_TAG_FIELDS } from '../src/longform/config.js';
import { runLongformScan } from '../src/longform/pipeline.js';
import { createQuotaGuard } from '../src/quota.js';
import {
  createLongformFixtureClient,
  EXPECTED_ORDER,
  EXPECTED_ROW_COUNT,
  FIXTURE_NOW,
  FIXTURE_SEEDS,
} from './fixtures/longform.js';

const silent = { log() {}, warn() {}, error() {} };

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
  const client = await createLongformFixtureClient();
  const quota = createQuotaGuard({ logger: silent });
  const result = await runLongformScan({
    client,
    quota,
    now: FIXTURE_NOW,
    seeds: FIXTURE_SEEDS,
    logger: silent,
    ...overrides,
  });
  return { ...result, client, quota };
}

describe('runLongformScan against offline fixtures', () => {
  it('produces exactly the expected row count', async () => {
    const { records } = await run();
    assert.equal(records.length, EXPECTED_ROW_COUNT);
  });

  it('sorts by score, highest first', async () => {
    const { records } = await run();
    assert.deepEqual(
      records.map((r) => r.videoId),
      EXPECTED_ORDER,
    );
  });

  it('rejects each candidate for the right reason', async () => {
    const { stats } = await run();

    assert.equal(stats.candidates, 6, 'the video shared by two seeds counts once');
    assert.equal(stats.rejectedDuration, 2, 'the 12-minute trailer and the 8-hour VOD');
    assert.equal(stats.rejectedViews, 1);
    assert.equal(stats.rejectedSubs, 1, 'the 9M-subscriber channel');
    assert.equal(stats.newRecords, EXPECTED_ROW_COUNT);
  });

  it('computes lift from the channel median, not the subscriber count', async () => {
    const { records } = await run();
    const breakout = records.find((r) => r.videoId === 'lf_pass_1');

    assert.equal(breakout.channelMedian, 50_000);
    assert.equal(breakout.lift, 16.4);
    assert.equal(breakout.subs, 48_000, 'subs are recorded but not used as the denominator');
  });

  it('ranks a small-channel breakout above a big-channel routine upload', async () => {
    const { records } = await run();
    const [first, second] = records;

    assert.equal(first.videoId, 'lf_pass_1');
    assert.ok(
      first.subs < second.subs,
      'the winner has FEWER subscribers — that is the whole point of the formula',
    );
  });

  it('writes long-form shaped records with empty manual tag columns', async () => {
    const { records } = await run();
    const record = records.find((r) => r.videoId === 'lf_pass_2');

    assert.equal(record.url, 'https://www.youtube.com/watch?v=lf_pass_2');
    assert.equal(record.durationSec, 5_400);
    assert.equal(record.durationMin, 90, 'minutes are precomputed for the viewer');
    assert.equal(record.seed, 'truyện ngôn tình full');

    for (const field of MANUAL_TAG_FIELDS) {
      assert.equal(record[field], '', `${field} must start empty`);
    }
    assert.ok('MO_TIP' in record, 'long-form tags on narrative premise, not visual mechanic');
    assert.ok(!('HOOK_MECHANIC' in record), 'the Shorts column must not leak in');
  });

  it('excludes uploads too young to have accumulated views from the median', async () => {
    const { records } = await run();
    const breakout = records.find((r) => r.videoId === 'lf_pass_1');

    // ch_ma's two freshest uploads have 120 and 340 views. Counting them would
    // drag the median from 50,000 down toward the floor and inflate lift ~50x.
    // This is a regression guard for a bug seen in live data.
    assert.equal(breakout.channelMedian, 50_000);
    assert.ok(breakout.lift < 20, `lift ${breakout.lift} suggests fresh uploads leaked in`);
  });

  it('skips a channel with too few mature uploads to form a baseline', async () => {
    const { records } = await run();
    assert.ok(
      !records.some((r) => r.channelId === 'ch_huge'),
      'a 2-video baseline is not a baseline',
    );
  });

  it('only fetches medians for channels that survived the filters', async () => {
    const { client } = await run();
    // ch_huge was filtered on subscriber count, so its uploads are never paged.
    assert.equal(client.calls.playlistItems, 2);
  });

  it('makes zero network calls', async () => {
    const { client } = await run();
    assert.ok(client.calls.search > 0, 'the fixture client really was exercised');
  });

  it('skips videos already present in the data file', async () => {
    const { records, stats } = await run({ existingIds: new Set(['lf_pass_1']) });

    assert.equal(records.length, 1);
    assert.equal(records[0].videoId, 'lf_pass_2');
    assert.equal(stats.duplicates, 1);
  });
});

describe('long-form quota guard', () => {
  it('stops cleanly instead of throwing when the budget runs out', async () => {
    const quota = createQuotaGuard({ spent: QUOTA.DAILY_BUDGET, logger: silent });
    const client = await createLongformFixtureClient();

    const { records, stats } = await runLongformScan({
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

  it('drops records whose median was never fetched rather than inventing a lift', async () => {
    // Leave exactly enough headroom for 2 searches + one videos.list + one
    // channels.list, so the guard trips on the first median fetch. Derived from
    // the constants rather than hardcoded so a config change cannot rot it.
    const threshold = QUOTA.DAILY_BUDGET * QUOTA.GUARD_RATIO;
    const spendBeforeMedians =
      2 * QUOTA.COST.SEARCH + QUOTA.COST.VIDEOS + QUOTA.COST.CHANNELS;

    const quota = createQuotaGuard({ spent: threshold - spendBeforeMedians, logger: silent });
    const client = await createLongformFixtureClient();

    const { records, stats } = await runLongformScan({
      client,
      quota,
      now: FIXTURE_NOW,
      seeds: FIXTURE_SEEDS,
      logger: silent,
    });

    assert.equal(stats.quotaTripped, true);
    assert.equal(records.length, 0, 'no median means no score, not a fabricated one');
    assert.ok(stats.rejectedNoMedian > 0);
  });
});
