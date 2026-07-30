import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AUDIO_AI_SEEDS, QUOTA, SEED_KEYWORDS } from '../src/config.js';

describe('seed sets', () => {
  it('has no overlap between the visual and audio sets', () => {
    const overlap = AUDIO_AI_SEEDS.filter((seed) => SEED_KEYWORDS.includes(seed));
    assert.deepEqual(overlap, [], 'a duplicated seed would double-spend quota for nothing');
  });

  it('contains no duplicates within either set', () => {
    for (const [label, seeds] of [['visual', SEED_KEYWORDS], ['audio', AUDIO_AI_SEEDS]]) {
      assert.equal(new Set(seeds).size, seeds.length, `${label} set has a duplicate`);
    }
  });

  it('keeps a combined run under the quota guard threshold', () => {
    const combined = SEED_KEYWORDS.length + AUDIO_AI_SEEDS.length;
    const cost = combined * QUOTA.COST.SEARCH;
    const threshold = QUOTA.DAILY_BUDGET * QUOTA.GUARD_RATIO;

    assert.ok(
      cost < threshold,
      `scanning all ${combined} seeds costs ${cost}, which would trip the ${threshold} guard`,
    );
  });
});
