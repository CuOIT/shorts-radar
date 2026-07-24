import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isShortDuration, parseIso8601Duration } from '../src/duration.js';

describe('parseIso8601Duration', () => {
  it('parses seconds-only durations', () => {
    assert.equal(parseIso8601Duration('PT15S'), 15);
    assert.equal(parseIso8601Duration('PT59S'), 59);
  });

  it('parses minutes and seconds', () => {
    assert.equal(parseIso8601Duration('PT1M'), 60);
    assert.equal(parseIso8601Duration('PT1M13S'), 73);
    assert.equal(parseIso8601Duration('PT3M12S'), 192);
  });

  it('parses hours and days', () => {
    assert.equal(parseIso8601Duration('PT1H'), 3600);
    assert.equal(parseIso8601Duration('PT2H30M5S'), 9005);
    assert.equal(parseIso8601Duration('P1DT2H'), 93600);
  });

  it('rounds fractional seconds', () => {
    assert.equal(parseIso8601Duration('PT30.5S'), 31);
    assert.equal(parseIso8601Duration('PT30.4S'), 30);
  });

  it('tolerates surrounding whitespace', () => {
    assert.equal(parseIso8601Duration('  PT20S '), 20);
  });

  it('returns null for anything it cannot trust', () => {
    for (const bad of ['', 'P', 'PT', 'not a duration', '15', 'P1W', 'P1Y2M', null, undefined, 42, {}]) {
      assert.equal(parseIso8601Duration(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  it('parses a zero-length duration as 0, not null', () => {
    assert.equal(parseIso8601Duration('PT0S'), 0);
  });
});

describe('isShortDuration', () => {
  it('accepts real Shorts up to the ceiling, inclusive', () => {
    assert.equal(isShortDuration('PT1S', 60), true);
    assert.equal(isShortDuration('PT60S', 60), true);
    assert.equal(isShortDuration('PT1M', 60), true);
  });

  it('rejects anything longer than the ceiling', () => {
    assert.equal(isShortDuration('PT61S', 60), false);
    // The exact trap this guards: videoDuration=short means "under 4 minutes".
    assert.equal(isShortDuration('PT3M12S', 60), false);
  });

  it('rejects zero-length and unparseable durations', () => {
    assert.equal(isShortDuration('PT0S', 60), false);
    assert.equal(isShortDuration('garbage', 60), false);
  });

  it('honours a raised ceiling for long-form Shorts', () => {
    assert.equal(isShortDuration('PT2M30S', 180), true);
  });
});
