/**
 * Phase 0 lean seed — STRUCTURAL FACTS ONLY.
 *
 * Seeds: 48 team identities, 16 venue physical facts, one $0 ledger init row.
 * Does NOT seed: ratings, stats, style profiles, rosters, fixtures, FIFA IDs,
 * capacities — agents fetch those from authoritative live sources in Phase 1+.
 *
 * Idempotent: existing rows (matched by short_name / venue name) are skipped.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { db } from './index';
import { teams, venues, bankroll_ledger } from './schema';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Groups — single source of truth is /src/shared/config/groups.json
// ---------------------------------------------------------------------------

const GroupsSchema = z.record(
  z.string().regex(/^[A-L]$/),
  z.array(z.string().length(3)).length(4)
);

export function loadGroups(): Record<string, string[]> {
  const raw = readFileSync(join(__dirname, '../shared/config/groups.json'), 'utf-8');
  const groups = GroupsSchema.parse(JSON.parse(raw));
  if (Object.keys(groups).length !== 12) {
    throw new Error(`groups.json must define exactly 12 groups, found ${Object.keys(groups).length}`);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Team identity — name + confederation per short_name (official FIFA spellings)
// ---------------------------------------------------------------------------

type Confederation = 'CONCACAF' | 'CONMEBOL' | 'UEFA' | 'CAF' | 'AFC' | 'OFC';

const TEAM_IDENTITY: Record<string, { name: string; confederation: Confederation }> = {
  MEX: { name: 'Mexico', confederation: 'CONCACAF' },
  RSA: { name: 'South Africa', confederation: 'CAF' },
  KOR: { name: 'Korea Republic', confederation: 'AFC' },
  CZE: { name: 'Czechia', confederation: 'UEFA' },
  CAN: { name: 'Canada', confederation: 'CONCACAF' },
  BIH: { name: 'Bosnia and Herzegovina', confederation: 'UEFA' },
  QAT: { name: 'Qatar', confederation: 'AFC' },
  SUI: { name: 'Switzerland', confederation: 'UEFA' },
  BRA: { name: 'Brazil', confederation: 'CONMEBOL' },
  MAR: { name: 'Morocco', confederation: 'CAF' },
  HAI: { name: 'Haiti', confederation: 'CONCACAF' },
  SCO: { name: 'Scotland', confederation: 'UEFA' },
  USA: { name: 'United States', confederation: 'CONCACAF' },
  PAR: { name: 'Paraguay', confederation: 'CONMEBOL' },
  AUS: { name: 'Australia', confederation: 'AFC' },
  TUR: { name: 'Turkiye', confederation: 'UEFA' },
  GER: { name: 'Germany', confederation: 'UEFA' },
  CUW: { name: 'Curaçao', confederation: 'CONCACAF' },
  CIV: { name: 'Ivory Coast', confederation: 'CAF' },
  ECU: { name: 'Ecuador', confederation: 'CONMEBOL' },
  NED: { name: 'Netherlands', confederation: 'UEFA' },
  JPN: { name: 'Japan', confederation: 'AFC' },
  SWE: { name: 'Sweden', confederation: 'UEFA' },
  TUN: { name: 'Tunisia', confederation: 'CAF' },
  BEL: { name: 'Belgium', confederation: 'UEFA' },
  EGY: { name: 'Egypt', confederation: 'CAF' },
  IRN: { name: 'Iran', confederation: 'AFC' },
  NZL: { name: 'New Zealand', confederation: 'OFC' },
  ESP: { name: 'Spain', confederation: 'UEFA' },
  CPV: { name: 'Cabo Verde', confederation: 'CAF' },
  KSA: { name: 'Saudi Arabia', confederation: 'AFC' },
  URU: { name: 'Uruguay', confederation: 'CONMEBOL' },
  FRA: { name: 'France', confederation: 'UEFA' },
  SEN: { name: 'Senegal', confederation: 'CAF' },
  IRQ: { name: 'Iraq', confederation: 'AFC' },
  NOR: { name: 'Norway', confederation: 'UEFA' },
  ARG: { name: 'Argentina', confederation: 'CONMEBOL' },
  ALG: { name: 'Algeria', confederation: 'CAF' },
  AUT: { name: 'Austria', confederation: 'UEFA' },
  JOR: { name: 'Jordan', confederation: 'AFC' },
  POR: { name: 'Portugal', confederation: 'UEFA' },
  COD: { name: 'DR Congo', confederation: 'CAF' },
  UZB: { name: 'Uzbekistan', confederation: 'AFC' },
  COL: { name: 'Colombia', confederation: 'CONMEBOL' },
  ENG: { name: 'England', confederation: 'UEFA' },
  CRO: { name: 'Croatia', confederation: 'UEFA' },
  GHA: { name: 'Ghana', confederation: 'CAF' },
  PAN: { name: 'Panama', confederation: 'CONCACAF' }
};

// ---------------------------------------------------------------------------
// Venues — physical facts only (capacity intentionally NULL)
// ---------------------------------------------------------------------------

interface VenueSeed {
  name: string;
  city: string;
  country: string;
  latitude: string;
  longitude: string;
  altitude_meters: number;
  timezone: string;
}

const VENUE_SEED: VenueSeed[] = [
  // Mexico (3)
  { name: 'Estadio Azteca', city: 'Mexico City', country: 'Mexico', latitude: '19.30290', longitude: '-99.15050', altitude_meters: 2240, timezone: 'America/Mexico_City' },
  { name: 'Estadio Akron', city: 'Guadalajara', country: 'Mexico', latitude: '20.68170', longitude: '-103.46250', altitude_meters: 1550, timezone: 'America/Mexico_City' },
  { name: 'Estadio BBVA', city: 'Monterrey', country: 'Mexico', latitude: '25.66920', longitude: '-100.24440', altitude_meters: 540, timezone: 'America/Monterrey' },
  // Canada (2)
  { name: 'BMO Field', city: 'Toronto', country: 'Canada', latitude: '43.63280', longitude: '-79.41870', altitude_meters: 76, timezone: 'America/Toronto' },
  { name: 'BC Place', city: 'Vancouver', country: 'Canada', latitude: '49.27680', longitude: '-123.11190', altitude_meters: 5, timezone: 'America/Vancouver' },
  // United States (11)
  { name: 'MetLife Stadium', city: 'East Rutherford', country: 'United States', latitude: '40.81360', longitude: '-74.07440', altitude_meters: 7, timezone: 'America/New_York' },
  { name: 'AT&T Stadium', city: 'Arlington', country: 'United States', latitude: '32.74730', longitude: '-97.09450', altitude_meters: 158, timezone: 'America/Chicago' },
  { name: 'SoFi Stadium', city: 'Inglewood', country: 'United States', latitude: '33.95350', longitude: '-118.33920', altitude_meters: 30, timezone: 'America/Los_Angeles' },
  { name: 'Lumen Field', city: 'Seattle', country: 'United States', latitude: '47.59520', longitude: '-122.33160', altitude_meters: 17, timezone: 'America/Los_Angeles' },
  { name: "Levi's Stadium", city: 'Santa Clara', country: 'United States', latitude: '37.40320', longitude: '-121.96970', altitude_meters: 4, timezone: 'America/Los_Angeles' },
  { name: 'Hard Rock Stadium', city: 'Miami Gardens', country: 'United States', latitude: '25.95800', longitude: '-80.23890', altitude_meters: 2, timezone: 'America/New_York' },
  { name: 'NRG Stadium', city: 'Houston', country: 'United States', latitude: '29.68470', longitude: '-95.41070', altitude_meters: 14, timezone: 'America/Chicago' },
  { name: 'Lincoln Financial Field', city: 'Philadelphia', country: 'United States', latitude: '39.90080', longitude: '-75.16750', altitude_meters: 8, timezone: 'America/New_York' },
  { name: 'Mercedes-Benz Stadium', city: 'Atlanta', country: 'United States', latitude: '33.75530', longitude: '-84.40060', altitude_meters: 320, timezone: 'America/New_York' },
  { name: 'Gillette Stadium', city: 'Foxborough', country: 'United States', latitude: '42.09090', longitude: '-71.26430', altitude_meters: 67, timezone: 'America/New_York' },
  { name: 'Arrowhead Stadium', city: 'Kansas City', country: 'United States', latitude: '39.04890', longitude: '-94.48390', altitude_meters: 230, timezone: 'America/Chicago' }
];

const HIGH_ALTITUDE_THRESHOLD_M = 1500;

// ---------------------------------------------------------------------------
// Seed runner
// ---------------------------------------------------------------------------

export async function seed(): Promise<void> {
  const groups = loadGroups();
  const groupCodes = Object.values(groups).flat();

  if (groupCodes.length !== 48) {
    throw new Error(`groups.json must contain 48 teams, found ${groupCodes.length}`);
  }
  for (const code of groupCodes) {
    if (!TEAM_IDENTITY[code]) throw new Error(`No identity mapping for short_name ${code}`);
  }

  // --- Teams (identity only) ---
  const existingTeams = await db
    .select({ short_name: teams.short_name })
    .from(teams)
    .where(inArray(teams.short_name, groupCodes));
  const existingCodes = new Set(existingTeams.map((t) => t.short_name));

  const newTeams = groupCodes
    .filter((code) => !existingCodes.has(code))
    .map((code) => ({
      name: TEAM_IDENTITY[code].name,
      short_name: code,
      confederation: TEAM_IDENTITY[code].confederation
      // Everything else stays NULL — populated by agents from live sources.
    }));

  if (newTeams.length > 0) {
    await db.insert(teams).values(newTeams);
  }
  console.log(`Teams: inserted ${newTeams.length}, skipped ${existingCodes.size} existing`);

  // --- Venues (physical facts only) ---
  const existingVenues = await db.select({ name: venues.name }).from(venues);
  const existingVenueNames = new Set(existingVenues.map((v) => v.name));

  const newVenues = VENUE_SEED
    .filter((v) => !existingVenueNames.has(v.name))
    .map((v) => ({
      name: v.name,
      city: v.city,
      country: v.country,
      latitude: v.latitude,
      longitude: v.longitude,
      altitude_meters: v.altitude_meters,
      surface_type: 'natural_grass',
      // capacity stays NULL — varies by World Cup configuration, fetched in Phase 1
      is_indoor: false,
      is_outdoor: true,
      timezone: v.timezone,
      is_high_altitude: v.altitude_meters > HIGH_ALTITUDE_THRESHOLD_M
    }));

  if (newVenues.length > 0) {
    await db.insert(venues).values(newVenues);
  }
  console.log(`Venues: inserted ${newVenues.length}, skipped ${existingVenueNames.size} existing`);

  // --- Initial bankroll ledger row (only if ledger is empty) ---
  const ledgerRows = await db.select({ id: bankroll_ledger.id }).from(bankroll_ledger).limit(1);
  if (ledgerRows.length === 0) {
    await db.insert(bankroll_ledger).values({
      entry_type: 'adjustment',
      amount_cents: 0n,
      balance_after_cents: 0n,
      notes: 'World Cup bankroll initialization — awaiting allocation',
      source: 'manual'
    });
    console.log('Bankroll ledger: initialization row inserted ($0.00)');
  } else {
    console.log('Bankroll ledger: already initialized, skipped');
  }

  // --- Integrity verification ---
  const allTeams = await db.select({ confederation: teams.confederation }).from(teams);
  const counts = new Map<string, number>();
  for (const t of allTeams) counts.set(t.confederation, (counts.get(t.confederation) ?? 0) + 1);

  const expected: Record<string, number> = {
    CONCACAF: 6, CONMEBOL: 6, UEFA: 16, CAF: 10, AFC: 9, OFC: 1
  };
  let ok = allTeams.length === 48;
  for (const [conf, n] of Object.entries(expected)) {
    const actual = counts.get(conf) ?? 0;
    if (actual !== n) ok = false;
    console.log(`  ${conf}: ${actual} (expected ${n})`);
  }
  if (!ok) {
    throw new Error(`Seed integrity check FAILED — team count ${allTeams.length}, see counts above`);
  }
  console.log(`Seed integrity: 48 teams, confederation counts verified ✓`);
}

