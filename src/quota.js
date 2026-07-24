import { QUOTA } from './config.js';

/**
 * Daily quota accounting.
 *
 * The failure this exists to prevent: silently burning through the 10,000-unit
 * daily quota, getting empty results, and concluding "there are no trends today".
 * When the guard trips it logs loudly and the run exits CLEANLY with whatever it
 * already collected — it does not throw, because a partial day of data is still data.
 */
export function createQuotaGuard({
  spent = 0,
  budget = QUOTA.DAILY_BUDGET,
  guardRatio = QUOTA.GUARD_RATIO,
  logger = console,
} = {}) {
  let used = spent;
  let tripped = false;

  return {
    get spent() {
      return used;
    },
    get tripped() {
      return tripped;
    },
    get remaining() {
      return budget - used;
    },

    /** True if `cost` more units would push past the guard threshold. */
    wouldExceed(cost) {
      return used + cost > budget * guardRatio;
    },

    /**
     * Check before an expensive call. Logs and latches `tripped` on refusal so
     * the caller can stop the loop instead of hammering a dead quota.
     */
    allow(cost, label = 'call') {
      if (this.wouldExceed(cost)) {
        tripped = true;
        logger.warn(
          `[quota] guard triggered before ${label}: ${used}/${budget} used, ` +
            `${cost} more would pass the ${guardRatio * 100}% threshold. Stopping cleanly.`,
        );
        return false;
      }
      return true;
    },

    spend(cost) {
      used += cost;
      return used;
    },
  };
}

/**
 * Quota resets at midnight Pacific in reality, but UTC day is close enough and
 * far easier to reason about. Off-by-a-few-hours costs us nothing at ~2k/10k usage.
 */
export function utcDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
