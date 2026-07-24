/**
 * Scoring.
 *
 * The intent is to surface videos that OVERPERFORM RELATIVE TO CHANNEL SIZE,
 * not videos with the most views. A 500k-view Short from a 10k-sub channel is a
 * signal about the hook. The same 500k from a 5M-sub channel is just the brand.
 *
 * WARNING: these weights are an assumption, not a finding. They must be
 * recalibrated against hand-tagged VERDICT data (run #4 in the plan) before any
 * decision is made on them. Changing the formula requires updating test/score.test.js.
 */

/** Floor for the subscriber denominator, so tiny channels don't produce infinities. */
const MIN_SUBS_DENOMINATOR = 500;
/** Floor for the age denominator: a video younger than an hour counts as one hour old. */
const MIN_HOURS_DENOMINATOR = 1;
/** Softens views-per-hour so a viral spike can't drown out the outlier term. */
const VPH_LOG_OFFSET = 10;

/**
 * @param {string} publishedAt ISO 8601 timestamp
 * @param {Date} now
 * @returns {number} hours elapsed, floored at MIN_HOURS_DENOMINATOR
 */
export function hoursSincePublish(publishedAt, now) {
  const published = new Date(publishedAt).getTime();
  if (!Number.isFinite(published)) return MIN_HOURS_DENOMINATOR;

  const hours = (now.getTime() - published) / 3_600_000;
  return Math.max(hours, MIN_HOURS_DENOMINATOR);
}

/**
 * @param {{views: number, subs: number, publishedAt: string}} input
 * @param {Date} now
 * @returns {{outlier: number, vph: number, score: number}}
 */
export function scoreVideo({ views, subs, publishedAt }, now) {
  const outlier = views / Math.max(subs, MIN_SUBS_DENOMINATOR);
  const vph = views / hoursSincePublish(publishedAt, now);
  const score = outlier * Math.log10(vph + VPH_LOG_OFFSET);

  return {
    outlier: round(outlier, 3),
    vph: round(vph, 1),
    score: round(score, 3),
  };
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
