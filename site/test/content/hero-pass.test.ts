// Feature: showcase-site, tasks 25 and 47: the hero pass is a sample pass for the event itself.
import { describe, expect, test } from 'vitest';
import { HERO_PASS } from '../../src/lib/content/hero-pass';
import { layoutPass } from '../../src/lib/demo/pass-layout';

describe('the home page hero pass', () => {
  test('is a pass for AWS re:Invent 2026 in Las Vegas', () => {
    expect(HERO_PASS).toMatchObject({
      session: '2026',
      title: 'AWS re:Invent',
      terminal: 'USA',
      gate: 'Las Vegas, NV',
      date: 'Nov. 30 - Dec. 4',
      boardingCloses: '07:50',
    });
  });

  test('says it is a sample and not a real booking and carries the disclaimer', () => {
    expect(HERO_PASS.label).toBe('Sample pass. Not a real booking.');
    expect(HERO_PASS.disclaimer).toBe('Unofficial. Your badge is your ticket.');
  });

  test('its accessible name reads the fields in the order the pass draws them', () => {
    const cardText = layoutPass(HERO_PASS, { flightNameFirst: true })
      .lines.filter((line) => line.onCard && line.kind !== 'label')
      .map((line) => line.text);
    expect(cardText).toEqual([
      '2026',
      'AWS re:Invent',
      'USA',
      'Las Vegas, NV',
      'Nov. 30 - Dec. 4',
      '07:50',
    ]);
    expect(HERO_PASS.accessibleName).toMatch(
      /^Boarding pass\. Session 2026\. Flight name: AWS re:Invent\. Terminal: USA\. Gate: Las Vegas, NV\. Date: Nov\. 30 - Dec\. 4\. Boarding closes: 07:50\./,
    );
  });
});
