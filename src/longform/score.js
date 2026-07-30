/**
 * Long-form scoring.
 *
 * Two deliberate departures from the Shorts formula in src/score.js:
 *
 * 1. The denominator is the channel's OWN median view count, not its subscriber
 *    count. Audio-story listeners consume without subscribing, so views/subs is
 *    dominated by that noise. "This episode did 4x what this channel normally
 *    does" is a statement about the PREMISE, which is what we are hunting.
 *
 * 2. Velocity is measured per day, not per hour. Long-form burns slowly over
 *    weeks; an hourly rate would rank a 2-day-old video above a 60-day-old one
 *    that has ten times the views.
 *
 * These weights remain an assumption. Recalibrate against the hand-tagged
 * VERDICT column before trusting the ordering.
 */

/** Guards against a brand-new channel whose median is 0 or absurdly small. */
const MEDIAN_FLOOR = 1_000;
/** A video published today counts as one day old. */
const MIN_DAYS_DENOMINATOR = 1;
/** Softens views-per-day so one viral episode cannot swamp the lift term. */
const VPD_LOG_OFFSET = 10;

/**
 * @param {number[]} values
 * @returns {number} the median, or 0 for an empty list
 */
export function median(values) {
  const numbers = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (numbers.length === 0) return 0;

  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 0
    ? (numbers[middle - 1] + numbers[middle]) / 2
    : numbers[middle];
}

/**
 * @param {string} publishedAt ISO 8601 timestamp
 * @param {Date} now
 * @returns {number} days elapsed, floored at MIN_DAYS_DENOMINATOR
 */
export function daysSincePublish(publishedAt, now) {
  const published = new Date(publishedAt).getTime();
  if (!Number.isFinite(published)) return MIN_DAYS_DENOMINATOR;

  const days = (now.getTime() - published) / 86_400_000;
  return Math.max(days, MIN_DAYS_DENOMINATOR);
}

/**
 * @param {{views: number, channelMedian: number, publishedAt: string}} input
 * @param {Date} now
 * @returns {{lift: number, vpd: number, score: number}}
 */
export function scoreLongform({ views, channelMedian, publishedAt }, now) {
  const lift = views / Math.max(channelMedian, MEDIAN_FLOOR);
  const vpd = views / daysSincePublish(publishedAt, now);
  const score = lift * Math.log10(vpd + VPD_LOG_OFFSET);

  return {
    lift: round(lift, 3),
    vpd: round(vpd, 1),
    score: round(score, 3),
  };
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
