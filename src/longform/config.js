/**
 * Long-form audio-story tunables. Separate from src/config.js because almost
 * nothing carries over: the duration filter runs the other direction, the time
 * constant is days instead of hours, and the audience is Vietnamese.
 */

/**
 * Seeds here ARE topic-shaped, and that is deliberate.
 *
 * The original rule ("seed by mechanic, not topic") existed because the niche
 * was undecided — topic seeds would only confirm an existing bias. The niche is
 * now decided: truyện ma, trinh thám, ngôn tình. So the discovery question moves
 * up a level, from "which niche?" to "which PREMISE and TITLE FORMULA travels
 * inside these three?". That question is answered by the hand-tagged MO_TIP
 * column, not by the seed list.
 */
export const SEED_KEYWORDS = [
  // truyện ma
  'truyện ma có thật',
  'truyện ma đêm khuya',
  'truyện ma làng quê',
  'kể chuyện ma',
  // trinh thám
  'truyện trinh thám phá án',
  'truyện trinh thám hình sự',
  'vụ án có thật',
  // ngôn tình
  'truyện ngôn tình full',
  'truyện ngôn tình hay',
  'audio truyện ngôn tình',
  // chung
  'audio truyện đêm khuya',
  'truyện audio full',
];

export const FILTERS = {
  /** Long-form climbs for weeks, so a 7-day window would miss the winners. */
  LOOKBACK_DAYS: 30,
  /** 20 minutes — matches the API's videoDuration=long bucket. */
  MIN_SECONDS: 1_200,
  /** 6 hours — anything longer is almost always a livestream VOD or a loop. */
  MAX_SECONDS: 21_600,
  /** UNVERIFIED GUESS: the Vietnamese market is smaller than the global Shorts pool. */
  MIN_VIEWS: 20_000,
  /** UNVERIFIED GUESS: below this a channel has no usable upload history. */
  SUB_MIN: 1_000,
  /** UNVERIFIED GUESS. */
  SUB_MAX: 5_000_000,
};

export const API = {
  REGION: 'VN',
  LANG: 'vi',
  RESULTS_PER_SEED: 50,
  BATCH_SIZE: 50,
  /**
   * How many of a channel's recent uploads to page for its view median.
   * 50 is the API maximum and costs the same 1 unit as 20 would.
   */
  CHANNEL_SAMPLE: 50,
  /**
   * Uploads younger than this are EXCLUDED from the median.
   *
   * Without it the median is badly broken for high-frequency channels: they
   * publish daily, so their 20 newest videos have near-zero views, the median
   * collapses toward the floor, and every one of their older videos scores an
   * enormous fake lift. Observed live — a 128k-subscriber channel produced a
   * median of 184 views and swept the top of the ranking.
   */
  MEDIAN_MIN_AGE_DAYS: 14,
  /** Below this many mature uploads, a channel has no trustworthy baseline. */
  MEDIAN_MIN_SAMPLE: 5,
};

/** Manual tag columns. MO_TIP replaces HOOK_MECHANIC: the hook here is narrative, not visual. */
export const MANUAL_TAG_FIELDS = ['MO_TIP', 'AI_FEASIBLE_1_5', 'VERDICT'];

export default { SEED_KEYWORDS, FILTERS, API, MANUAL_TAG_FIELDS };
