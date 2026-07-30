/**
 * Offline fixture client for the long-form pipeline. Zero network.
 *
 * The cast is chosen so each filter has exactly one victim:
 *   lf_pass_1   45 min, huge lift over its channel median  -> keeps
 *   lf_pass_2   90 min, modest lift                        -> keeps
 *   lf_short    12 min                                     -> rejected: too short
 *   lf_stream    8 hours                                   -> rejected: livestream VOD
 *   lf_lowview  60 min, 4k views                           -> rejected: under MIN_VIEWS
 *   lf_huge     60 min, channel has 9M subs                -> rejected: channel too big
 */

export const FIXTURE_SEEDS = ['truyện ma có thật', 'truyện ngôn tình full'];
export const FIXTURE_NOW = new Date('2026-07-30T12:00:00Z');
export const EXPECTED_ROW_COUNT = 2;
export const EXPECTED_ORDER = ['lf_pass_1', 'lf_pass_2'];

const SEARCH = {
  'truyện ma có thật': ['lf_pass_1', 'lf_short', 'lf_stream', 'lf_lowview'],
  'truyện ngôn tình full': ['lf_pass_2', 'lf_huge', 'lf_pass_1'],
};

const VIDEOS = {
  lf_pass_1: {
    id: 'lf_pass_1',
    snippet: {
      publishedAt: '2026-07-20T00:00:00Z',
      channelId: 'ch_ma',
      channelTitle: 'Truyện Ma Đêm Khuya',
      title: 'Chuyến xe cuối cùng về quê ăn Tết - Truyện ma có thật',
      thumbnails: { high: { url: 'https://i.ytimg.com/vi/lf_pass_1/hq.jpg' } },
    },
    statistics: { viewCount: '820000', likeCount: '14000', commentCount: '900' },
    contentDetails: { duration: 'PT45M12S' },
  },
  lf_pass_2: {
    id: 'lf_pass_2',
    snippet: {
      publishedAt: '2026-07-10T00:00:00Z',
      channelId: 'ch_ngontinh',
      channelTitle: 'Ngôn Tình Radio',
      title: 'Gả cho tổng tài lạnh lùng - Ngôn tình full',
      thumbnails: { maxres: { url: 'https://i.ytimg.com/vi/lf_pass_2/max.jpg' } },
    },
    statistics: { viewCount: '260000', likeCount: '5100', commentCount: '210' },
    contentDetails: { duration: 'PT1H30M' },
  },
  lf_short: {
    id: 'lf_short',
    snippet: {
      publishedAt: '2026-07-25T00:00:00Z',
      channelId: 'ch_ma',
      channelTitle: 'Truyện Ma Đêm Khuya',
      title: 'Trailer tập mới',
      thumbnails: { high: { url: 'https://i.ytimg.com/vi/lf_short/hq.jpg' } },
    },
    statistics: { viewCount: '500000', likeCount: '9000', commentCount: '100' },
    contentDetails: { duration: 'PT12M' },
  },
  lf_stream: {
    id: 'lf_stream',
    snippet: {
      publishedAt: '2026-07-22T00:00:00Z',
      channelId: 'ch_ma',
      channelTitle: 'Truyện Ma Đêm Khuya',
      title: 'Tổng hợp 100 truyện ma - nghe cả đêm',
      thumbnails: { high: { url: 'https://i.ytimg.com/vi/lf_stream/hq.jpg' } },
    },
    statistics: { viewCount: '700000', likeCount: '11000', commentCount: '300' },
    contentDetails: { duration: 'PT8H' },
  },
  lf_lowview: {
    id: 'lf_lowview',
    snippet: {
      publishedAt: '2026-07-18T00:00:00Z',
      channelId: 'ch_ma',
      channelTitle: 'Truyện Ma Đêm Khuya',
      title: 'Truyện ma ít người nghe',
      thumbnails: { high: { url: 'https://i.ytimg.com/vi/lf_lowview/hq.jpg' } },
    },
    statistics: { viewCount: '4000', likeCount: '80', commentCount: '3' },
    contentDetails: { duration: 'PT1H' },
  },
  lf_huge: {
    id: 'lf_huge',
    snippet: {
      publishedAt: '2026-07-15T00:00:00Z',
      channelId: 'ch_huge',
      channelTitle: 'Kênh Truyện Khổng Lồ',
      title: 'Ngôn tình tuyển tập',
      thumbnails: { high: { url: 'https://i.ytimg.com/vi/lf_huge/hq.jpg' } },
    },
    statistics: { viewCount: '3000000', likeCount: '50000', commentCount: '2000' },
    contentDetails: { duration: 'PT1H' },
  },
};

const CHANNELS = {
  ch_ma: {
    id: 'ch_ma',
    statistics: { subscriberCount: '48000', hiddenSubscriberCount: false },
    contentDetails: { relatedPlaylists: { uploads: 'UU_ma' } },
  },
  ch_ngontinh: {
    id: 'ch_ngontinh',
    statistics: { subscriberCount: '120000', hiddenSubscriberCount: false },
    contentDetails: { relatedPlaylists: { uploads: 'UU_ngontinh' } },
  },
  ch_huge: {
    id: 'ch_huge',
    statistics: { subscriberCount: '9000000', hiddenSubscriberCount: false },
    contentDetails: { relatedPlaylists: { uploads: 'UU_huge' } },
  },
};

/**
 * Recent uploads per channel, used to compute the view median.
 *
 * `MATURE` entries are older than MEDIAN_MIN_AGE_DAYS (14) relative to
 * FIXTURE_NOW; `FRESH` ones are days old with almost no views yet. The fresh
 * rows exist to prove the age filter excludes them — if it regressed, the
 * ch_ma median would collapse from 50k toward zero and lift would explode.
 */
const MATURE = '2026-07-01T00:00:00Z';
const FRESH = '2026-07-29T00:00:00Z';

const UPLOADS = {
  // mature median of [30k, 40k, 50k, 60k, 70k] = 50k -> lf_pass_1 is a 16.4x lift
  UU_ma: [
    { id: 'ma_f1', views: 120, publishedAt: FRESH },
    { id: 'ma_f2', views: 340, publishedAt: FRESH },
    { id: 'ma_r1', views: 30_000, publishedAt: MATURE },
    { id: 'ma_r2', views: 40_000, publishedAt: MATURE },
    { id: 'ma_r3', views: 50_000, publishedAt: MATURE },
    { id: 'ma_r4', views: 60_000, publishedAt: MATURE },
    { id: 'ma_r5', views: 70_000, publishedAt: MATURE },
  ],
  // mature median of [190k, 210k, 230k, 250k, 270k] = 230k -> lf_pass_2 is ~1.1x
  UU_ngontinh: [
    { id: 'nt_r1', views: 190_000, publishedAt: MATURE },
    { id: 'nt_r2', views: 210_000, publishedAt: MATURE },
    { id: 'nt_r3', views: 230_000, publishedAt: MATURE },
    { id: 'nt_r4', views: 250_000, publishedAt: MATURE },
    { id: 'nt_r5', views: 270_000, publishedAt: MATURE },
  ],
  // Only 2 mature uploads — below MEDIAN_MIN_SAMPLE, so this channel is skipped
  // entirely rather than scored off a baseline of two videos.
  UU_huge: [
    { id: 'hg_r1', views: 2_000_000, publishedAt: MATURE },
    { id: 'hg_r2', views: 2_200_000, publishedAt: MATURE },
  ],
};

export async function createLongformFixtureClient() {
  const calls = { search: 0, videos: 0, channels: 0, playlistItems: 0 };

  const recentById = new Map();
  for (const items of Object.values(UPLOADS)) {
    for (const item of items) {
      recentById.set(item.id, {
        id: item.id,
        snippet: { publishedAt: item.publishedAt },
        statistics: { viewCount: String(item.views) },
      });
    }
  }

  return {
    calls,

    async search({ q, videoDuration }) {
      if (videoDuration !== 'long') {
        throw new Error(`long-form search must use videoDuration=long, got "${videoDuration}"`);
      }
      const ids = SEARCH[q];
      if (!ids) throw new Error(`fixture: no search fixture for seed "${q}"`);
      calls.search += 1;
      return { items: ids.map((id) => ({ id: { videoId: id } })) };
    },

    async videos(ids) {
      calls.videos += 1;
      const items = ids.map((id) => VIDEOS[id] ?? recentById.get(id)).filter(Boolean);
      return { items };
    },

    async channels(ids) {
      calls.channels += 1;
      return { items: ids.map((id) => CHANNELS[id]).filter(Boolean) };
    },

    async playlistItems(playlistId, maxResults) {
      calls.playlistItems += 1;
      const items = (UPLOADS[playlistId] ?? []).slice(0, maxResults);
      return { items: items.map((item) => ({ contentDetails: { videoId: item.id } })) };
    },
  };
}
