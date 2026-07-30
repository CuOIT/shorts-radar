#!/usr/bin/env node
import { AUDIO_AI_SEEDS, FILTERS, SEED_KEYWORDS } from './config.js';
import { SEED_KEYWORDS as LONGFORM_SEEDS, FILTERS as LONGFORM_FILTERS } from './longform/config.js';
import { runLongformScan } from './longform/pipeline.js';
import { runScan } from './pipeline.js';
import { createQuotaGuard } from './quota.js';
import { createStore } from './store.js';
import { createClient } from './youtube.js';

/**
 * CLI entry point.
 *
 *   node src/scan.js                    live run, requires YT_API_KEY
 *   node src/scan.js --dry-run          offline fixtures, zero network, writes nothing
 *   node src/scan.js --seeds=audio      scan the audio-AI seed set instead
 *   node src/scan.js --seeds=all        scan both Shorts sets in one run
 *   node src/scan.js --mode=longform    Vietnamese long-form audio stories
 *                                       (own seeds, own scoring, own data file)
 *
 * Exit codes: 0 success, 1 failure. A non-zero exit is what makes the GitHub
 * Actions workflow fail loudly instead of committing an empty day.
 */

const isDryRun = process.argv.includes('--dry-run');

const SEED_SETS = {
  visual: SEED_KEYWORDS,
  audio: AUDIO_AI_SEEDS,
  all: [...SEED_KEYWORDS, ...AUDIO_AI_SEEDS],
};

function selectedSeeds() {
  const arg = process.argv.find((a) => a.startsWith('--seeds='));
  const name = arg ? arg.slice('--seeds='.length) : 'visual';
  const seeds = SEED_SETS[name];
  if (!seeds) {
    throw new Error(`--seeds=${name} không hợp lệ. Chọn: ${Object.keys(SEED_SETS).join(', ')}`);
  }
  return { name, seeds };
}

main().catch((error) => {
  console.error(`[scan] FAILED: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exitCode = 1;
});

async function main() {
  if (isDryRun) return dryRun();
  return liveRun();
}

function isLongform() {
  return process.argv.includes('--mode=longform');
}

async function liveRun() {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey) {
    throw new Error('YT_API_KEY is not set. Put it in .env locally or in GitHub Secrets for CI.');
  }

  const longform = isLongform();
  const now = new Date();
  const client = createClient({ apiKey });

  // Long-form writes to its own dataset. Mixing the two would be meaningless:
  // the scores come from different formulas and are not comparable.
  const store = createStore({ dataset: longform ? 'longform' : 'raw' });

  const { name: seedSetName, seeds } = longform
    ? { name: 'longform', seeds: LONGFORM_SEEDS }
    : selectedSeeds();

  const persistedQuota = await store.loadQuota(now);
  const quota = createQuotaGuard({ spent: persistedQuota.spent });

  const raw = await store.loadRaw(now);
  const existingIds = new Set(raw.records.map((record) => record.videoId));

  console.log(
    `[scan] ${now.toISOString()} | seed set "${seedSetName}" (${seeds.length} seeds) | ` +
      `${raw.records.length} records on file | quota already spent today: ${persistedQuota.spent}`,
  );

  let result;
  try {
    result = longform
      ? await runLongformScan({ client, quota, now, seeds, existingIds })
      : await runScan({ client, quota, now, seeds, existingIds });
  } finally {
    // Persist spend even on failure — a crashed run still burned real quota.
    await store.saveQuota({ date: persistedQuota.date, spent: quota.spent });
  }

  const { records, stats } = result;

  if (records.length > 0) {
    raw.records.push(...records);
    await store.saveRaw(raw, now);
  }

  await store.saveLastRun({
    date: now.toISOString().slice(0, 10),
    finishedAt: now.toISOString(),
    newRecords: stats.newRecords,
    totalRecords: raw.records.length,
    stats,
  });

  printSummary(stats, raw.records.length);

  if (stats.quotaTripped) {
    console.warn('[scan] finished early: daily quota guard tripped. Data written is partial.');
  }
}

async function dryRun() {
  const fixtures = await import('../test/fixtures/index.js');

  // Hard guarantee of "zero network calls": any fetch attempt aborts the run.
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('dry-run attempted a network call');
  };

  try {
    const client = await fixtures.createFixtureClient();
    const quota = createQuotaGuard();

    const { records, stats } = await runScan({
      client,
      quota,
      now: fixtures.FIXTURE_NOW,
      seeds: fixtures.FIXTURE_SEEDS,
    });

    printSummary(stats, records.length);
    console.log('\n[dry-run] rows:');
    for (const record of records) {
      console.log(
        `  ${record.score.toFixed(1).padStart(8)}  ${String(record.subs).padStart(9)} subs  ` +
          `${String(record.views).padStart(9)} views  ${record.durationSec}s  ${record.title}`,
      );
    }

    const expected = fixtures.EXPECTED_ROW_COUNT;
    if (records.length !== expected) {
      throw new Error(`expected ${expected} rows from fixtures, got ${records.length}`);
    }
    if (client.calls.search + client.calls.videos + client.calls.channels === 0) {
      throw new Error('fixture client was never called — the pipeline did nothing');
    }

    console.log(`\n[dry-run] OK — ${expected} rows, ${quota.spent} quota units, 0 network calls.`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

function printSummary(stats, totalRecords) {
  const longform = isLongform();

  const durationLabel = longform
    ? `rejected: outside ${LONGFORM_FILTERS.MIN_SECONDS / 60}-${LONGFORM_FILTERS.MAX_SECONDS / 60}min`
    : `rejected: over ${FILTERS.MAX_SECONDS}s`;
  const viewsLabel = longform
    ? `rejected: under ${LONGFORM_FILTERS.MIN_VIEWS} views`
    : `rejected: under ${FILTERS.MIN_VIEWS} views`;

  const rows = [
    ['seeds scanned', `${stats.seedsScanned} (skipped ${stats.seedsSkipped})`],
    ['candidates', stats.candidates],
    [durationLabel, stats.rejectedDuration],
    [viewsLabel, stats.rejectedViews],
    ['rejected: channel size', stats.rejectedSubs],
    ...(longform ? [['rejected: no channel median', stats.rejectedNoMedian]] : []),
    ['duplicates skipped', stats.duplicates],
    ['NEW RECORDS', stats.newRecords],
    ['total on file', totalRecords],
    ['quota spent', `${stats.quotaSpent}${stats.quotaTripped ? ' (GUARD TRIPPED)' : ''}`],
  ];

  console.log('');
  for (const [label, value] of rows) {
    console.log(`  ${String(label).padEnd(28)} ${value}`);
  }
  console.log('');
}
