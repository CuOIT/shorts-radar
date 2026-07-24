/**
 * Every tunable value in the system lives here. Nothing in src/ may hardcode a
 * threshold — if you find yourself typing a number in pipeline.js, it belongs here.
 */

/**
 * Seeds are VISUAL FORMATS, not topics.
 *
 * Seeding by topic ("space facts", "ancient rome") only confirms the bias you
 * already have. Seeding by hook mechanic turns the scanner into a discovery
 * tool: it tells you which formats travel, and lets the topic fall out of the
 * data instead of out of your assumptions.
 */
export const SEED_KEYWORDS = [
  'satisfying process',
  'oddly satisfying',
  'size comparison',
  'scale comparison',
  'macro slow motion',
  'slow motion close up',
  'extreme close up',
  'zoom out reveal',
  'before and after transformation',
  'restoration process',
  'cutting open',
  'hydraulic press',
  'pressure washing',
  'time lapse growth',
  'chain reaction',
  'marble run',
  'first person pov',
  'x ray view',
  'laser engraving',
  'liquid mixing macro',
];

export const FILTERS = {
  /** Only look at uploads from the last N days — catches trends on the way up. */
  LOOKBACK_DAYS: 7,
  /**
   * Client-side duration ceiling, in seconds. The API's `videoDuration=short`
   * means "under 4 minutes", NOT "is a Short" — see parseIso8601Duration.
   * Raise to 180 if you want to cover long-form Shorts.
   */
  MAX_SECONDS: 60,
  /** Below this, you are looking at noise. */
  MIN_VIEWS: 50_000,
  /** Below this subscriber count, an outlier is usually luck. */
  SUB_MIN: 500,
  /** Above this, the views come from the brand, not from the hook. */
  SUB_MAX: 2_000_000,
};

export const API = {
  REGION: 'US',
  LANG: 'en',
  /** search.list caps at 50 results per call; one call per seed per day. */
  RESULTS_PER_SEED: 50,
  /** videos.list and channels.list both accept up to 50 ids per call. */
  BATCH_SIZE: 50,
  /** Transient 5xx / network retries before the run gives up loudly. */
  MAX_RETRIES: 2,
  RETRY_BASE_MS: 1_000,
};

/**
 * YouTube Data API v3 quota. Free tier is 10,000 units/day.
 * With 20 seeds: 20 x 100 + ~60 = ~2,060 units. Room to grow to 60-70 seeds.
 */
export const QUOTA = {
  DAILY_BUDGET: 10_000,
  /** Stop starting new searches once this fraction of the budget is spent. */
  GUARD_RATIO: 0.8,
  COST: {
    SEARCH: 100,
    VIDEOS: 1,
    CHANNELS: 1,
  },
};

export const STORAGE = {
  /** data/raw.json rotates into data/archive/ when the UTC month changes... */
  ROTATE_MONTHLY: true,
  /** ...or when it grows past this, whichever comes first. */
  MAX_BYTES: 5 * 1024 * 1024,
};

/** Manual tag columns. The scanner writes them empty; you fill them in the viewer. */
export const MANUAL_TAG_FIELDS = ['HOOK_MECHANIC', 'AI_FEASIBLE_1_5', 'VERDICT'];

export default { SEED_KEYWORDS, FILTERS, API, QUOTA, STORAGE, MANUAL_TAG_FIELDS };
