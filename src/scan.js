#!/usr/bin/env node
import { FILTERS, SEED_KEYWORDS } from './config.js';
import { runScan } from './pipeline.js';
import { createQuotaGuard } from './quota.js';
import { createStore } from './store.js';
import { createClient } from './youtube.js';

/**
 * CLI entry point.
 *
 *   node src/scan.js              live run, requires YT_API_KEY
 *   node src/scan.js --dry-run    offline fixtures, zero network, writes nothing
 *
 * Exit codes: 0 success, 1 failure. A non-zero exit is what makes the GitHub
 * Actions workflow fail loudly instead of committing an empty day.
 */

const isDryRun = process.argv.includes('--dry-run');

main().catch((error) => {
  console.error(`[scan] FAILED: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exitCode = 1;
});

async function main() {
  if (isDryRun) return dryRun();
  return liveRun();
}

async function liveRun() {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey) {
    throw new Error('YT_API_KEY is not set. Put it in .env locally or in GitHub Secrets for CI.');
  }

  const now = new Date();
  const store = createStore();
  const client = createClient({ apiKey });

  const persistedQuota = await store.loadQuota(now);
  const quota = createQuotaGuard({ spent: persistedQuota.spent });

  const raw = await store.loadRaw(now);
  const existingIds = new Set(raw.records.map((record) => record.videoId));

  console.log(
    `[scan] ${now.toISOString()} | ${SEED_KEYWORDS.length} seeds | ` +
      `${raw.records.length} records on file | quota already spent today: ${persistedQuota.spent}`,
  );

  let result;
  try {
    result = await runScan({ client, quota, now, existingIds });
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
  const rows = [
    ['seeds scanned', `${stats.seedsScanned} (skipped ${stats.seedsSkipped})`],
    ['candidates', stats.candidates],
    [`rejected: over ${FILTERS.MAX_SECONDS}s`, stats.rejectedDuration],
    [`rejected: under ${FILTERS.MIN_VIEWS} views`, stats.rejectedViews],
    ['rejected: channel size', stats.rejectedSubs],
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
