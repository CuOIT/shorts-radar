import { readFile } from 'node:fs/promises';

/**
 * Offline fixture client. Used by test/pipeline.test.js and by
 * `npm run dry-run`, so the dry run exercises exactly the code path the tests do.
 *
 * It counts calls and refuses unknown seeds, so a pipeline change that starts
 * making extra requests shows up as a failure rather than as silence.
 */

export const FIXTURE_SEEDS = ['satisfying process', 'size comparison'];

/** Fixed clock so scores in the fixtures are deterministic. */
export const FIXTURE_NOW = new Date('2026-07-24T12:00:00Z');

/** Three of the eight fixture videos survive every filter. */
export const EXPECTED_ROW_COUNT = 3;

/** Highest score first. */
export const EXPECTED_ORDER = ['vid_pass_3', 'vid_pass_1', 'vid_pass_2'];

/** 2 searches x 100 + 1 videos.list + 1 channels.list */
export const EXPECTED_QUOTA_SPEND = 202;

const SEARCH_FILES = {
  'satisfying process': 'search-satisfying-process.json',
  'size comparison': 'search-size-comparison.json',
};

async function load(name) {
  const file = new URL(name, import.meta.url);
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function createFixtureClient() {
  const [videos, channels] = await Promise.all([load('videos.json'), load('channels.json')]);

  const calls = { search: 0, videos: 0, channels: 0 };

  return {
    calls,

    async search({ q }) {
      const file = SEARCH_FILES[q];
      if (!file) throw new Error(`fixture client: no search fixture for seed "${q}"`);
      calls.search += 1;
      return load(file);
    },

    async videos(ids) {
      calls.videos += 1;
      const wanted = new Set(ids);
      return { items: videos.items.filter((item) => wanted.has(item.id)) };
    },

    async channels(ids) {
      calls.channels += 1;
      const wanted = new Set(ids);
      return { items: channels.items.filter((item) => wanted.has(item.id)) };
    },
  };
}
