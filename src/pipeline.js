import { API, FILTERS, MANUAL_TAG_FIELDS, QUOTA, SEED_KEYWORDS } from './config.js';
import { parseIso8601Duration } from './duration.js';
import { scoreVideo } from './score.js';

/**
 * search.list per seed -> videos.list in batches of 50 -> channels.list in
 * batches of 50 -> filter -> score -> dedupe -> new records.
 *
 * Everything it needs is injected, so the whole pipeline is testable against
 * fixtures with zero network calls.
 */
export async function runScan({
  client,
  quota,
  now = new Date(),
  seeds = SEED_KEYWORDS,
  filters = FILTERS,
  existingIds = new Set(),
  logger = console,
} = {}) {
  const stats = {
    seedsScanned: 0,
    seedsSkipped: 0,
    candidates: 0,
    rejectedDuration: 0,
    rejectedViews: 0,
    rejectedSubs: 0,
    duplicates: 0,
    newRecords: 0,
    quotaSpent: 0,
    quotaTripped: false,
  };

  const publishedAfter = new Date(
    now.getTime() - filters.LOOKBACK_DAYS * 86_400_000,
  ).toISOString();

  // ---- 1. search: one call per seed, first seed wins on collisions ----------
  /** @type {Map<string, string>} videoId -> seed that surfaced it */
  const seedByVideoId = new Map();

  for (const seed of seeds) {
    if (!quota.allow(QUOTA.COST.SEARCH, `search "${seed}"`)) {
      stats.seedsSkipped = seeds.length - stats.seedsScanned;
      break;
    }

    const response = await client.search({
      q: seed,
      publishedAfter,
      maxResults: API.RESULTS_PER_SEED,
      regionCode: API.REGION,
      relevanceLanguage: API.LANG,
    });
    quota.spend(QUOTA.COST.SEARCH);
    stats.seedsScanned += 1;

    for (const item of response?.items ?? []) {
      const videoId = item?.id?.videoId;
      if (videoId && !seedByVideoId.has(videoId)) seedByVideoId.set(videoId, seed);
    }
  }

  stats.candidates = seedByVideoId.size;
  if (seedByVideoId.size === 0) {
    stats.quotaSpent = quota.spent;
    stats.quotaTripped = quota.tripped;
    return { records: [], stats };
  }

  // ---- 2. videos.list: the only place duration and view count are truthful --
  const videos = [];
  for (const batch of chunk([...seedByVideoId.keys()], API.BATCH_SIZE)) {
    if (!quota.allow(QUOTA.COST.VIDEOS, 'videos.list')) break;
    const response = await client.videos(batch);
    quota.spend(QUOTA.COST.VIDEOS);
    videos.push(...(response?.items ?? []));
  }

  // ---- 3. filter on duration and views before spending anything on channels -
  const kept = [];
  for (const video of videos) {
    const seconds = parseIso8601Duration(video?.contentDetails?.duration);
    if (seconds === null || seconds <= 0 || seconds > filters.MAX_SECONDS) {
      stats.rejectedDuration += 1;
      continue;
    }

    const views = toInt(video?.statistics?.viewCount);
    if (views < filters.MIN_VIEWS) {
      stats.rejectedViews += 1;
      continue;
    }

    kept.push({ video, seconds, views });
  }

  if (kept.length === 0) {
    stats.quotaSpent = quota.spent;
    stats.quotaTripped = quota.tripped;
    return { records: [], stats };
  }

  // ---- 4. channels.list: subscriber counts for the survivors only -----------
  const channelIds = [...new Set(kept.map((entry) => entry.video.snippet.channelId))];
  /** @type {Map<string, number|null>} null = channel hides its subscriber count */
  const subsByChannel = new Map();

  for (const batch of chunk(channelIds, API.BATCH_SIZE)) {
    if (!quota.allow(QUOTA.COST.CHANNELS, 'channels.list')) break;
    const response = await client.channels(batch);
    quota.spend(QUOTA.COST.CHANNELS);

    for (const item of response?.items ?? []) {
      const hidden = item?.statistics?.hiddenSubscriberCount === true;
      subsByChannel.set(item.id, hidden ? null : toInt(item?.statistics?.subscriberCount));
    }
  }

  // ---- 5. filter on channel size, score, dedupe ----------------------------
  const records = [];
  const seenThisRun = new Set();

  for (const { video, seconds, views } of kept) {
    const subs = subsByChannel.get(video.snippet.channelId);
    // Unknown or hidden subscriber count makes the outlier ratio meaningless.
    if (subs === null || subs === undefined) {
      stats.rejectedSubs += 1;
      continue;
    }
    if (subs < filters.SUB_MIN || subs > filters.SUB_MAX) {
      stats.rejectedSubs += 1;
      continue;
    }

    if (existingIds.has(video.id) || seenThisRun.has(video.id)) {
      stats.duplicates += 1;
      continue;
    }
    seenThisRun.add(video.id);

    const publishedAt = video.snippet.publishedAt;
    const { outlier, vph, score } = scoreVideo({ views, subs, publishedAt }, now);

    records.push({
      videoId: video.id,
      url: `https://www.youtube.com/shorts/${video.id}`,
      title: video.snippet.title,
      channelId: video.snippet.channelId,
      channelTitle: video.snippet.channelTitle,
      thumbnail: pickThumbnail(video.snippet.thumbnails),
      publishedAt,
      firstSeenAt: now.toISOString(),
      seed: seedByVideoId.get(video.id) ?? null,
      durationSec: seconds,
      views,
      likes: toInt(video?.statistics?.likeCount),
      comments: toInt(video?.statistics?.commentCount),
      subs,
      outlier,
      vph,
      score,
      // Filled in by hand later. The scanner never writes to these.
      ...Object.fromEntries(MANUAL_TAG_FIELDS.map((field) => [field, ''])),
    });
  }

  records.sort((a, b) => b.score - a.score);

  stats.newRecords = records.length;
  stats.quotaSpent = quota.spent;
  stats.quotaTripped = quota.tripped;

  logger.log(
    `[scan] seeds ${stats.seedsScanned}/${seeds.length}, candidates ${stats.candidates}, ` +
      `new ${stats.newRecords}, dupes ${stats.duplicates}, quota ${stats.quotaSpent}`,
  );

  return { records, stats };
}

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toInt(value) {
  const parsed = Number.parseInt(value ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickThumbnail(thumbnails) {
  return (
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url ??
    null
  );
}
