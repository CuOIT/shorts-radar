import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STORAGE } from './config.js';
import { utcDateKey } from './quota.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * All persistence lives here: the JSON files under data/ are the database.
 * Writes go through a temp file + rename so a crashed run can never leave a
 * half-written raw.json in the repo.
 */
export function createStore({ root = REPO_ROOT, logger = console, dataset = 'raw' } = {}) {
  const dataDir = path.join(root, 'data');
  const archiveDir = path.join(dataDir, 'archive');

  const rawPath = path.join(dataDir, `${dataset}.json`);
  const lastRunPath = path.join(dataDir, `${dataset}-last-run.json`);

  // Quota is deliberately NOT per-dataset: the 10,000 units/day belong to the
  // API key, not to a scan mode. Shorts and long-form runs draw from one pot.
  const quotaPath = path.join(dataDir, 'quota.json');

  return {
    paths: { dataDir, archiveDir, rawPath, quotaPath, lastRunPath },

    /**
     * Loads data/raw.json, rotating it into data/archive/ first if the UTC month
     * changed or the file grew past the size cap. Keeps the repo from bloating
     * and keeps the viewer's fetch small.
     */
    async loadRaw(now = new Date()) {
      await mkdir(dataDir, { recursive: true });

      const currentMonth = utcMonthKey(now);
      const existing = await readJson(rawPath);

      if (!existing) return { month: currentMonth, updatedAt: null, records: [] };

      const monthChanged = STORAGE.ROTATE_MONTHLY && existing.month !== currentMonth;
      const tooBig = (await fileSize(rawPath)) > STORAGE.MAX_BYTES;

      if (monthChanged || tooBig) {
        await mkdir(archiveDir, { recursive: true });
        const target = await freePath(archiveDir, `${dataset}-${existing.month ?? 'unknown'}`);
        await rename(rawPath, target);
        logger.log(
          `[store] rotated ${path.basename(rawPath)} -> ${path.relative(root, target)} ` +
            `(${monthChanged ? 'new month' : 'size cap'})`,
        );
        return { month: currentMonth, updatedAt: null, records: [] };
      }

      return {
        month: existing.month ?? currentMonth,
        updatedAt: existing.updatedAt ?? null,
        records: Array.isArray(existing.records) ? existing.records : [],
      };
    },

    async saveRaw({ month, records }, now = new Date()) {
      await writeJson(rawPath, {
        month,
        updatedAt: now.toISOString(),
        count: records.length,
        records,
      });
    },

    /** Quota spend is per UTC day; a new day starts the counter at zero. */
    async loadQuota(now = new Date()) {
      const today = utcDateKey(now);
      const existing = await readJson(quotaPath);
      if (!existing || existing.date !== today) return { date: today, spent: 0 };
      return { date: today, spent: Number(existing.spent) || 0 };
    },

    async saveQuota({ date, spent }) {
      await mkdir(dataDir, { recursive: true });
      await writeJson(quotaPath, { date, spent });
    },

    /** Read by the GitHub Actions workflow to build the commit message. */
    async saveLastRun(summary) {
      await mkdir(dataDir, { recursive: true });
      await writeJson(lastRunPath, summary);
    },
  };
}

export function utcMonthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

async function fileSize(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

/** Avoids clobbering an archive when rotation fires twice in one month. */
async function freePath(dir, base) {
  for (let n = 0; ; n += 1) {
    const candidate = path.join(dir, n === 0 ? `${base}.json` : `${base}-${n + 1}.json`);
    if ((await fileSize(candidate)) === 0) return candidate;
  }
}
