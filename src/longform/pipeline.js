import { QUOTA } from '../config.js';
import { parseIso8601Duration } from '../duration.js';
import { API, FILTERS, MANUAL_TAG_FIELDS, SEED_KEYWORDS } from './config.js';
import { median, scoreLongform } from './score.js';

/**
 * search.list per seed (videoDuration=long) -> videos.list -> channels.list ->
 * filter -> per-channel view median -> score -> dedupe.
 *
 * The extra step versus the Shorts pipeline is the channel median, and it runs
 * AFTER the duration and view filters on purpose: it costs 2 quota units per
 * channel, so it must only ever touch channels that already survived.
 */
export async function runLongformScan({
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
    rejectedNoMedian: 0,
    duplicates: 0,
    newRecords: 0,
    quotaSpent: 0,
    quotaTripped: false,
  };

  const publishedAfter = new Date(
    now.getTime() - filters.LOOKBACK_DAYS * 86_400_000,
  ).toISOString();

  // ---- 1. search ------------------------------------------------------------
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
      videoDuration: 'long',
    });
    quota.spend(QUOTA.COST.SEARCH);
    stats.seedsScanned += 1;

    for (const item of response?.items ?? []) {
      const videoId = item?.id?.videoId;
      if (videoId && !seedByVideoId.has(videoId)) seedByVideoId.set(videoId, seed);
    }
  }

  stats.candidates = seedByVideoId.size;
  if (seedByVideoId.size === 0) return finish([], stats, quota);

  // ---- 2. videos.list -------------------------------------------------------
  const videos = [];
  for (const batch of chunk([...seedByVideoId.keys()], API.BATCH_SIZE)) {
    if (!quota.allow(QUOTA.COST.VIDEOS, 'videos.list')) break;
    const response = await client.videos(batch);
    quota.spend(QUOTA.COST.VIDEOS);
    videos.push(...(response?.items ?? []));
  }

  // ---- 3. duration + views filter ------------------------------------------
  // videoDuration=long only guarantees ">20 min", so both bounds are re-checked.
  const kept = [];
  for (const video of videos) {
    const seconds = parseIso8601Duration(video?.contentDetails?.duration);
    if (seconds === null || seconds < filters.MIN_SECONDS || seconds > filters.MAX_SECONDS) {
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

  if (kept.length === 0) return finish([], stats, quota);

  // ---- 4. channels.list: subscriber count + uploads playlist id -------------
  const channelIds = [...new Set(kept.map((entry) => entry.video.snippet.channelId))];
  /** @type {Map<string, {subs: number|null, uploadsPlaylistId: string|null}>} */
  const channelInfo = new Map();

  for (const batch of chunk(channelIds, API.BATCH_SIZE)) {
    if (!quota.allow(QUOTA.COST.CHANNELS, 'channels.list')) break;
    const response = await client.channels(batch);
    quota.spend(QUOTA.COST.CHANNELS);

    for (const item of response?.items ?? []) {
      const hidden = item?.statistics?.hiddenSubscriberCount === true;
      channelInfo.set(item.id, {
        subs: hidden ? null : toInt(item?.statistics?.subscriberCount),
        uploadsPlaylistId: item?.contentDetails?.relatedPlaylists?.uploads ?? null,
      });
    }
  }

  // ---- 5. channel size filter, before spending on medians ------------------
  const survivors = [];
  for (const entry of kept) {
    const info = channelInfo.get(entry.video.snippet.channelId);
    const subs = info?.subs;
    if (subs === null || subs === undefined || subs < filters.SUB_MIN || subs > filters.SUB_MAX) {
      stats.rejectedSubs += 1;
      continue;
    }
    survivors.push({ ...entry, subs, uploadsPlaylistId: info.uploadsPlaylistId });
  }

  if (survivors.length === 0) return finish([], stats, quota);

  // ---- 6. per-channel view median ------------------------------------------
  const medianByChannel = new Map();
  const uniqueChannels = [
    ...new Map(
      survivors.map((entry) => [entry.video.snippet.channelId, entry.uploadsPlaylistId]),
    ).entries(),
  ];

  for (const [channelId, uploadsPlaylistId] of uniqueChannels) {
    if (!uploadsPlaylistId) continue;
    if (!quota.allow(QUOTA.COST.CHANNELS, `median for ${channelId}`)) break;

    const playlist = await client.playlistItems(uploadsPlaylistId, API.CHANNEL_SAMPLE);
    quota.spend(QUOTA.COST.CHANNELS);

    const ids = (playlist?.items ?? [])
      .map((item) => item?.contentDetails?.videoId)
      .filter(Boolean);
    if (ids.length === 0) continue;

    if (!quota.allow(QUOTA.COST.VIDEOS, `median videos for ${channelId}`)) break;
    const recent = await client.videos(ids.slice(0, API.BATCH_SIZE));
    quota.spend(QUOTA.COST.VIDEOS);

    // Only videos old enough to have finished accumulating views count toward
    // the baseline. See MEDIAN_MIN_AGE_DAYS for why this is not optional.
    const cutoff = now.getTime() - API.MEDIAN_MIN_AGE_DAYS * 86_400_000;
    const matureViews = (recent?.items ?? [])
      .filter((item) => {
        const published = new Date(item?.snippet?.publishedAt).getTime();
        return Number.isFinite(published) && published <= cutoff;
      })
      .map((item) => toInt(item?.statistics?.viewCount));

    // Too small a sample is worse than none: it would produce a confident-looking
    // lift built on one or two videos. Leave the channel out instead.
    if (matureViews.length < API.MEDIAN_MIN_SAMPLE) continue;

    medianByChannel.set(channelId, median(matureViews));
  }

  // ---- 7. score + dedupe ----------------------------------------------------
  const records = [];
  const seenThisRun = new Set();

  for (const { video, seconds, views, subs } of survivors) {
    const channelMedian = medianByChannel.get(video.snippet.channelId);
    // No median means the quota guard cut the enrichment short. Scoring without
    // it would silently fall back to the floor and invent a huge lift.
    if (channelMedian === undefined) {
      stats.rejectedNoMedian += 1;
      continue;
    }

    if (existingIds.has(video.id) || seenThisRun.has(video.id)) {
      stats.duplicates += 1;
      continue;
    }
    seenThisRun.add(video.id);

    const publishedAt = video.snippet.publishedAt;
    const { lift, vpd, score } = scoreLongform({ views, channelMedian, publishedAt }, now);

    records.push({
      videoId: video.id,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      title: video.snippet.title,
      channelId: video.snippet.channelId,
      channelTitle: video.snippet.channelTitle,
      thumbnail: pickThumbnail(video.snippet.thumbnails),
      publishedAt,
      firstSeenAt: now.toISOString(),
      seed: seedByVideoId.get(video.id) ?? null,
      durationSec: seconds,
      durationMin: Math.round(seconds / 60),
      views,
      likes: toInt(video?.statistics?.likeCount),
      comments: toInt(video?.statistics?.commentCount),
      subs,
      channelMedian,
      lift,
      vpd,
      score,
      ...Object.fromEntries(MANUAL_TAG_FIELDS.map((field) => [field, ''])),
    });
  }

  records.sort((a, b) => b.score - a.score);
  stats.newRecords = records.length;

  logger.log(
    `[longform] seeds ${stats.seedsScanned}/${seeds.length}, candidates ${stats.candidates}, ` +
      `new ${stats.newRecords}, dupes ${stats.duplicates}, quota ${quota.spent}`,
  );

  return finish(records, stats, quota);
}

function finish(records, stats, quota) {
  stats.quotaSpent = quota.spent;
  stats.quotaTripped = quota.tripped;
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
