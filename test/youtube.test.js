import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createClient } from '../src/youtube.js';

const silent = { log() {}, warn() {}, error() {} };
const noSleep = () => Promise.resolve();

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('youtube client', () => {
  it('refuses to be built without an API key', () => {
    assert.throws(() => createClient({ apiKey: '' }), /apiKey is required/);
  });

  it('sends the key as a query param and never in the code path', async () => {
    let seen;
    const client = createClient({
      apiKey: 'test-key',
      fetchImpl: async (url) => {
        seen = url;
        return jsonResponse({ items: [] });
      },
      logger: silent,
    });

    await client.search({ q: 'satisfying process', publishedAfter: '2026-07-17T00:00:00Z', maxResults: 50 });

    assert.equal(seen.searchParams.get('key'), 'test-key');
    assert.equal(seen.searchParams.get('q'), 'satisfying process');
    assert.equal(seen.searchParams.get('type'), 'video');
    assert.equal(seen.searchParams.get('order'), 'viewCount');
  });

  it('batches ids into a single comma-separated request', async () => {
    let seen;
    const client = createClient({
      apiKey: 'k',
      fetchImpl: async (url) => {
        seen = url;
        return jsonResponse({ items: [] });
      },
      logger: silent,
    });

    await client.videos(['a', 'b', 'c']);

    assert.equal(seen.searchParams.get('id'), 'a,b,c');
    assert.equal(seen.searchParams.get('part'), 'snippet,statistics,contentDetails');
  });

  it('retries a 5xx and then succeeds', async () => {
    let attempts = 0;
    const client = createClient({
      apiKey: 'k',
      logger: silent,
      sleep: noSleep,
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1 ? jsonResponse({ error: 'backend' }, 503) : jsonResponse({ items: [1] });
      },
    });

    const result = await client.channels(['c1']);
    assert.equal(attempts, 2);
    assert.deepEqual(result.items, [1]);
  });

  it('does not retry a 4xx — a bad key or exhausted quota will not fix itself', async () => {
    let attempts = 0;
    const client = createClient({
      apiKey: 'k',
      logger: silent,
      sleep: noSleep,
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse({ error: 'quotaExceeded' }, 403);
      },
    });

    await assert.rejects(() => client.videos(['v1']), /403/);
    assert.equal(attempts, 1);
  });
});
