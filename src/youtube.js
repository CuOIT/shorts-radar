import { API } from './config.js';

const BASE_URL = 'https://www.googleapis.com/youtube/v3';

/**
 * Minimal YouTube Data API v3 client built on global fetch (Node >= 18).
 *
 * `fetchImpl` is injectable purely so tests can run with zero network calls.
 * The API key is passed in by the caller, which reads it from the environment —
 * this module must never touch process.env itself.
 */
export function createClient({
  apiKey,
  fetchImpl = globalThis.fetch,
  baseUrl = BASE_URL,
  logger = console,
  sleep = defaultSleep,
} = {}) {
  if (!apiKey) throw new Error('createClient: apiKey is required');

  async function request(endpoint, params) {
    const url = new URL(`${baseUrl}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    url.searchParams.set('key', apiKey);

    let lastError;
    for (let attempt = 0; attempt <= API.MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
        if (response.ok) return await response.json();

        const body = (await safeText(response)).slice(0, 500);
        const error = new Error(`youtube ${endpoint} failed: ${response.status} ${body}`);
        error.status = response.status;

        // 4xx is our fault (bad key, bad params, quota exceeded) — retrying won't help.
        if (response.status < 500) throw error;
        lastError = error;
      } catch (error) {
        if (error.status && error.status < 500) throw error;
        lastError = error;
      }

      if (attempt < API.MAX_RETRIES) {
        const delay = API.RETRY_BASE_MS * 2 ** attempt;
        logger.warn(`[api] ${endpoint} attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
    throw lastError;
  }

  return {
    /**
     * Cost: 100 units. Returns raw search.list response.
     *
     * `videoDuration` is a coarse pre-filter only:
     *   'short'  = under 4 minutes  (NOT "is a Short")
     *   'medium' = 4 to 20 minutes
     *   'long'   = over 20 minutes
     * The real duration filter is always applied client-side on
     * contentDetails.duration, because these buckets do not match our thresholds.
     */
    search({ q, publishedAfter, maxResults, regionCode, relevanceLanguage, videoDuration = 'short' }) {
      return request('search', {
        part: 'snippet',
        type: 'video',
        videoDuration,
        order: 'viewCount',
        q,
        publishedAfter,
        maxResults,
        regionCode,
        relevanceLanguage,
      });
    },

    /** Cost: 1 unit per call, up to 50 ids. */
    videos(ids) {
      return request('videos', {
        part: 'snippet,statistics,contentDetails',
        id: ids.join(','),
        maxResults: API.BATCH_SIZE,
      });
    },

    /**
     * Cost: 1 unit per call, up to 50 ids.
     *
     * contentDetails carries relatedPlaylists.uploads, which is the only way to
     * page a channel's own uploads — needed to compute a channel view median.
     */
    channels(ids) {
      return request('channels', {
        part: 'statistics,contentDetails',
        id: ids.join(','),
        maxResults: API.BATCH_SIZE,
      });
    },

    /** Cost: 1 unit per call. Lists the most recent items of an uploads playlist. */
    playlistItems(playlistId, maxResults) {
      return request('playlistItems', {
        part: 'contentDetails',
        playlistId,
        maxResults,
      });
    },
  };
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return '<unreadable body>';
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
