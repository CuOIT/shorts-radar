/**
 * ISO 8601 duration parsing.
 *
 * This is the single most important filter in the scanner. `videoDuration=short`
 * on search.list means "under 4 minutes" — it does NOT mean "is a Short". Without
 * re-filtering on contentDetails.duration client-side you get a pile of 3-minute
 * landscape videos and no way to tell. Several paid tools get this wrong.
 */

// PnDTnHnMnS — YouTube never emits years/months/weeks for a video duration,
// so anything containing them is treated as unparseable rather than guessed at.
const DURATION_PATTERN = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * @param {unknown} value e.g. "PT1M13S"
 * @returns {number|null} whole seconds, or null if the string is not parseable
 */
export function parseIso8601Duration(value) {
  if (typeof value !== 'string') return null;

  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, days, hours, minutes, seconds] = match;

  // "P" and "PT" are syntactically valid but carry no components.
  if (days === undefined && hours === undefined && minutes === undefined && seconds === undefined) {
    return null;
  }

  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);

  return Math.round(total);
}

/**
 * @param {unknown} value ISO 8601 duration string
 * @param {number} maxSeconds inclusive upper bound
 * @returns {boolean} true only for a real, non-zero, short-enough clip
 */
export function isShortDuration(value, maxSeconds) {
  const seconds = parseIso8601Duration(value);
  return seconds !== null && seconds > 0 && seconds <= maxSeconds;
}
