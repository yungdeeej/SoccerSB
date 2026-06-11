/**
 * Team name resolution — The Odds API names → our short_name codes.
 * In-code alias map per the Phase 1 spec (NOT in the DB).
 * Unknown names are a hard skip + error log, never an auto-created team.
 */

/** Canonical FIFA name (as seeded) per short_name. */
const CANONICAL: Record<string, string> = {
  MEX: 'Mexico', RSA: 'South Africa', KOR: 'Korea Republic', CZE: 'Czechia',
  CAN: 'Canada', BIH: 'Bosnia and Herzegovina', QAT: 'Qatar', SUI: 'Switzerland',
  BRA: 'Brazil', MAR: 'Morocco', HAI: 'Haiti', SCO: 'Scotland',
  USA: 'United States', PAR: 'Paraguay', AUS: 'Australia', TUR: 'Turkiye',
  GER: 'Germany', CUW: 'Curaçao', CIV: 'Ivory Coast', ECU: 'Ecuador',
  NED: 'Netherlands', JPN: 'Japan', SWE: 'Sweden', TUN: 'Tunisia',
  BEL: 'Belgium', EGY: 'Egypt', IRN: 'Iran', NZL: 'New Zealand',
  ESP: 'Spain', CPV: 'Cabo Verde', KSA: 'Saudi Arabia', URU: 'Uruguay',
  FRA: 'France', SEN: 'Senegal', IRQ: 'Iraq', NOR: 'Norway',
  ARG: 'Argentina', ALG: 'Algeria', AUT: 'Austria', JOR: 'Jordan',
  POR: 'Portugal', COD: 'DR Congo', UZB: 'Uzbekistan', COL: 'Colombia',
  ENG: 'England', CRO: 'Croatia', GHA: 'Ghana', PAN: 'Panama'
};

/** Known alternative spellings used by The Odds API and books. */
const ALIASES: Record<string, string> = {
  'south korea': 'KOR',
  'korea republic': 'KOR',
  'republic of korea': 'KOR',
  'usa': 'USA',
  'united states': 'USA',
  'united states of america': 'USA',
  'czech republic': 'CZE',
  'czechia': 'CZE',
  'turkey': 'TUR',
  'turkiye': 'TUR',
  'türkiye': 'TUR',
  'cape verde': 'CPV',
  'cabo verde': 'CPV',
  'cape verde islands': 'CPV',
  'dr congo': 'COD',
  'congo dr': 'COD',
  'democratic republic of congo': 'COD',
  'democratic republic of the congo': 'COD',
  'congo, democratic republic': 'COD',
  'ivory coast': 'CIV',
  "côte d'ivoire": 'CIV',
  "cote d'ivoire": 'CIV',
  'bosnia and herzegovina': 'BIH',
  'bosnia-herzegovina': 'BIH',
  'bosnia & herzegovina': 'BIH',
  'bosnia': 'BIH',
  'iran': 'IRN',
  'ir iran': 'IRN',
  'islamic republic of iran': 'IRN',
  'curacao': 'CUW',
  'curaçao': 'CUW',
  'saudi arabia': 'KSA',
  'netherlands': 'NED',
  'holland': 'NED',
  'south africa': 'RSA'
};

const NAME_TO_CODE: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [code, name] of Object.entries(CANONICAL)) {
    map.set(name.toLowerCase(), code);
  }
  for (const [alias, code] of Object.entries(ALIASES)) {
    map.set(alias, code);
  }
  return map;
})();

/**
 * Resolve an external team name to our short_name code.
 * Returns null when unknown — caller must log and skip, never create a team.
 */
export function resolveTeamCode(externalName: string): string | null {
  return NAME_TO_CODE.get(externalName.trim().toLowerCase()) ?? null;
}

export function canonicalName(code: string): string | null {
  return CANONICAL[code] ?? null;
}
