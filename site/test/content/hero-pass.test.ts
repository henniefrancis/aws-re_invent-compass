// Feature: showcase-site, task 25: the hero pass is the demo's own pass, never invented.
import { describe, expect, test } from 'vitest';
import { HERO_PASS } from '../../src/lib/content/hero-pass';
import { STARTER_WEEK } from '../../src/lib/demo/demo-catalog';
import { createDemoRuntime, type DemoDeps } from '../../src/lib/demo/demo-deps';
import { EMPTY_DEMO, reduceDemo } from '../../src/lib/demo/demo-state';
import { REAL_ENGINE } from '../../src/lib/demo/rules-port';
import { buildSamplePass } from '../../src/lib/demo/sample-pass';
import { DEMO_VENUE_DATA } from '../../src/lib/demo/venue-data';

describe('the home page hero pass', () => {
  test('equals the pass the demo builds for the first session of its sample week', () => {
    const deps = createDemoRuntime(REAL_ENGINE, DEMO_VENUE_DATA) as DemoDeps;
    const week = reduceDemo(EMPTY_DEMO, { type: 'loadStarter' }, deps);
    expect(buildSamplePass(STARTER_WEEK[0] as string, week, deps)).toEqual(HERO_PASS);
  });

  test('says it is a sample and not a real booking and carries the disclaimer', () => {
    expect(HERO_PASS.label).toBe('Sample pass. Not a real booking.');
    expect(HERO_PASS.disclaimer).toBe('Unofficial. Your badge is your ticket.');
  });
});
