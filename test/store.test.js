import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createStore, utcMonthKey } from '../src/store.js';

const silent = { log() {}, warn() {}, error() {} };

async function tempStore() {
  const root = await mkdtemp(path.join(tmpdir(), 'shorts-radar-'));
  return { root, store: createStore({ root, logger: silent }) };
}

describe('store', () => {
  it('starts empty when there is no data file yet', async () => {
    const { store } = await tempStore();
    const raw = await store.loadRaw(new Date('2026-07-24T12:00:00Z'));

    assert.deepEqual(raw.records, []);
    assert.equal(raw.month, '2026-07');
  });

  it('round-trips records', async () => {
    const { store } = await tempStore();
    const now = new Date('2026-07-24T12:00:00Z');

    const raw = await store.loadRaw(now);
    raw.records.push({ videoId: 'abc', score: 1 });
    await store.saveRaw(raw, now);

    const reloaded = await store.loadRaw(now);
    assert.equal(reloaded.records.length, 1);
    assert.equal(reloaded.records[0].videoId, 'abc');

    const onDisk = JSON.parse(await readFile(store.paths.rawPath, 'utf8'));
    assert.equal(onDisk.count, 1);
    assert.equal(onDisk.updatedAt, now.toISOString());
  });

  it('rotates last month into the archive and starts fresh', async () => {
    const { root, store } = await tempStore();
    const june = new Date('2026-06-30T12:00:00Z');
    const july = new Date('2026-07-01T12:00:00Z');

    const raw = await store.loadRaw(june);
    raw.records.push({ videoId: 'june-video' });
    await store.saveRaw(raw, june);

    const fresh = await store.loadRaw(july);
    assert.deepEqual(fresh.records, [], 'July starts clean');
    assert.equal(fresh.month, '2026-07');
    assert.ok(existsSync(path.join(root, 'data', 'archive', 'raw-2026-06.json')));
  });

  it('resets the quota counter when the UTC day changes', async () => {
    const { store } = await tempStore();

    await store.saveQuota({ date: '2026-07-23', spent: 9_000 });

    const sameDay = await store.loadQuota(new Date('2026-07-23T23:00:00Z'));
    assert.equal(sameDay.spent, 9_000);

    const nextDay = await store.loadQuota(new Date('2026-07-24T00:30:00Z'));
    assert.equal(nextDay.spent, 0);
    assert.equal(nextDay.date, '2026-07-24');
  });

  it('survives a corrupt raw.json by failing loudly, not silently', async () => {
    const { root, store } = await tempStore();
    await mkdir(path.join(root, 'data'), { recursive: true });
    await writeFile(store.paths.rawPath, '{ not json', 'utf8');

    await assert.rejects(() => store.loadRaw(new Date('2026-07-24T12:00:00Z')));
  });

  it('derives the month key in UTC', () => {
    assert.equal(utcMonthKey(new Date('2026-01-01T00:00:00Z')), '2026-01');
    assert.equal(utcMonthKey(new Date('2026-12-31T23:59:59Z')), '2026-12');
  });
});
