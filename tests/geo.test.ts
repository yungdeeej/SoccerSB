import { describe, it, expect } from 'vitest';
import { haversineDistance, haversineMiles } from '../src/shared/utils/geo';

// Venue coordinates from the Phase 0 seed
const AZTECA = { lat: 19.3029, lng: -99.1505 };       // Mexico City
const METLIFE = { lat: 40.8136, lng: -74.0744 };      // East Rutherford NJ
const BC_PLACE = { lat: 49.2768, lng: -123.1119 };    // Vancouver

describe('haversineDistance', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistance(AZTECA.lat, AZTECA.lng, AZTECA.lat, AZTECA.lng)).toBe(0);
  });

  it('one degree of latitude at the equator is ~111.2 km', () => {
    expect(haversineDistance(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });

  it('is symmetric', () => {
    const ab = haversineDistance(AZTECA.lat, AZTECA.lng, METLIFE.lat, METLIFE.lng);
    const ba = haversineDistance(METLIFE.lat, METLIFE.lng, AZTECA.lat, AZTECA.lng);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('Azteca to MetLife is roughly 3,350-3,400 km (transcontinental travel band)', () => {
    const d = haversineDistance(AZTECA.lat, AZTECA.lng, METLIFE.lat, METLIFE.lng);
    expect(d).toBeGreaterThan(3300);
    expect(d).toBeLessThan(3450);
  });

  it('Azteca to BC Place is roughly 3,900-4,000 km', () => {
    const d = haversineDistance(AZTECA.lat, AZTECA.lng, BC_PLACE.lat, BC_PLACE.lng);
    expect(d).toBeGreaterThan(3900);
    expect(d).toBeLessThan(4000);
  });
});

describe('haversineMiles', () => {
  it('converts km to miles with the standard factor', () => {
    const km = haversineDistance(AZTECA.lat, AZTECA.lng, METLIFE.lat, METLIFE.lng);
    const miles = haversineMiles(AZTECA.lat, AZTECA.lng, METLIFE.lat, METLIFE.lng);
    expect(miles).toBeCloseTo(km * 0.621371, 6);
  });
});
