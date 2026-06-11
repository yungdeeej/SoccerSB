import { describe, it, expect } from 'vitest';
import {
  americanToDecimal,
  decimalToAmerican,
  stripVigTwoWay,
  stripVigThreeWay,
  calculateCLV
} from '../src/shared/utils/odds';

describe('americanToDecimal', () => {
  it('converts positive American odds', () => {
    expect(americanToDecimal(150)).toBeCloseTo(2.5, 10);
    expect(americanToDecimal(100)).toBeCloseTo(2.0, 10);
    expect(americanToDecimal(400)).toBeCloseTo(5.0, 10);
  });

  it('converts negative American odds', () => {
    expect(americanToDecimal(-200)).toBeCloseTo(1.5, 10);
    expect(americanToDecimal(-110)).toBeCloseTo(1.9091, 4);
    expect(americanToDecimal(-100)).toBeCloseTo(2.0, 10);
  });

  it('throws on zero and non-finite input', () => {
    expect(() => americanToDecimal(0)).toThrow();
    expect(() => americanToDecimal(NaN)).toThrow();
    expect(() => americanToDecimal(Infinity)).toThrow();
  });
});

describe('decimalToAmerican', () => {
  it('converts decimal >= 2 to positive American', () => {
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(decimalToAmerican(2.0)).toBe(100);
    expect(decimalToAmerican(5.0)).toBe(400);
  });

  it('converts decimal < 2 to negative American', () => {
    expect(decimalToAmerican(1.5)).toBe(-200);
    expect(decimalToAmerican(1.9091)).toBe(-110);
  });

  it('throws on invalid decimal odds', () => {
    expect(() => decimalToAmerican(1)).toThrow();
    expect(() => decimalToAmerican(0.5)).toThrow();
    expect(() => decimalToAmerican(NaN)).toThrow();
  });

  it('round-trips with americanToDecimal', () => {
    for (const odds of [-350, -200, -110, 105, 150, 240, 600]) {
      expect(decimalToAmerican(americanToDecimal(odds))).toBe(odds);
    }
  });
});

describe('stripVigTwoWay', () => {
  it('returns 50/50 for symmetric -110/-110', () => {
    const { side_a_no_vig, side_b_no_vig } = stripVigTwoWay(-110, -110);
    expect(side_a_no_vig).toBeCloseTo(0.5, 10);
    expect(side_b_no_vig).toBeCloseTo(0.5, 10);
  });

  it('sums to 1 for asymmetric markets', () => {
    const { side_a_no_vig, side_b_no_vig } = stripVigTwoWay(-150, 130);
    expect(side_a_no_vig + side_b_no_vig).toBeCloseTo(1, 10);
    expect(side_a_no_vig).toBeGreaterThan(side_b_no_vig);
  });
});

describe('stripVigThreeWay', () => {
  it('sums to 1 and orders correctly for a typical 1X2 market', () => {
    // France -180 / Draw +320 / Senegal +550
    const { home_no_vig, draw_no_vig, away_no_vig } = stripVigThreeWay(-180, 320, 550);
    expect(home_no_vig + draw_no_vig + away_no_vig).toBeCloseTo(1, 10);
    expect(home_no_vig).toBeGreaterThan(draw_no_vig);
    expect(draw_no_vig).toBeGreaterThan(away_no_vig);
  });

  it('strips vig symmetrically on an even three-way market', () => {
    const { home_no_vig, draw_no_vig, away_no_vig } = stripVigThreeWay(180, 180, 180);
    expect(home_no_vig).toBeCloseTo(1 / 3, 10);
    expect(draw_no_vig).toBeCloseTo(1 / 3, 10);
    expect(away_no_vig).toBeCloseTo(1 / 3, 10);
  });
});

describe('calculateCLV', () => {
  it('is positive when closing prob exceeds bet prob (beat the close)', () => {
    // Treasurer worked example: bet 32.8%, close 36.5% → +3.7¢
    expect(calculateCLV(0.328, 0.365)).toBeCloseTo(3.7, 10);
  });

  it('is negative when the line moved against us', () => {
    expect(calculateCLV(0.40, 0.37)).toBeCloseTo(-3, 10);
  });

  it('is zero when bet matches close', () => {
    expect(calculateCLV(0.5, 0.5)).toBe(0);
  });
});
