"""External-source team name → our short_name resolution (mirrors Phase 1 alias pattern)."""
from __future__ import annotations

CANONICAL: dict[str, str] = {
    "Mexico": "MEX", "South Africa": "RSA", "Korea Republic": "KOR", "Czechia": "CZE",
    "Canada": "CAN", "Bosnia and Herzegovina": "BIH", "Qatar": "QAT", "Switzerland": "SUI",
    "Brazil": "BRA", "Morocco": "MAR", "Haiti": "HAI", "Scotland": "SCO",
    "United States": "USA", "Paraguay": "PAR", "Australia": "AUS", "Turkiye": "TUR",
    "Germany": "GER", "Curaçao": "CUW", "Ivory Coast": "CIV", "Ecuador": "ECU",
    "Netherlands": "NED", "Japan": "JPN", "Sweden": "SWE", "Tunisia": "TUN",
    "Belgium": "BEL", "Egypt": "EGY", "Iran": "IRN", "New Zealand": "NZL",
    "Spain": "ESP", "Cabo Verde": "CPV", "Saudi Arabia": "KSA", "Uruguay": "URU",
    "France": "FRA", "Senegal": "SEN", "Iraq": "IRQ", "Norway": "NOR",
    "Argentina": "ARG", "Algeria": "ALG", "Austria": "AUT", "Jordan": "JOR",
    "Portugal": "POR", "DR Congo": "COD", "Uzbekistan": "UZB", "Colombia": "COL",
    "England": "ENG", "Croatia": "CRO", "Ghana": "GHA", "Panama": "PAN",
}

ALIASES: dict[str, str] = {
    "south korea": "KOR", "korea republic": "KOR", "republic of korea": "KOR",
    "usa": "USA", "united states": "USA", "united states of america": "USA",
    "czech republic": "CZE", "czechia": "CZE",
    "turkey": "TUR", "türkiye": "TUR", "turkiye": "TUR",
    "cape verde": "CPV", "cabo verde": "CPV", "cape verde islands": "CPV",
    "dr congo": "COD", "congo dr": "COD", "democratic republic of congo": "COD",
    "democratic republic of the congo": "COD", "congo, democratic republic": "COD",
    "ivory coast": "CIV", "côte d'ivoire": "CIV", "cote d'ivoire": "CIV", "cote divoire": "CIV",
    "bosnia and herzegovina": "BIH", "bosnia-herzegovina": "BIH", "bosnia & herzegovina": "BIH",
    "bosnia": "BIH",
    "iran": "IRN", "ir iran": "IRN", "islamic republic of iran": "IRN",
    "curacao": "CUW", "curaçao": "CUW",
    "saudi arabia": "KSA", "netherlands": "NED", "holland": "NED",
    "south africa": "RSA",
}

_LOOKUP: dict[str, str] = {name.lower(): code for name, code in CANONICAL.items()}
_LOOKUP.update(ALIASES)


def resolve_team_code(external_name: str) -> str | None:
    """Map an external source's team name to our short_name; None when unknown."""
    return _LOOKUP.get(external_name.strip().lower())


def all_short_names() -> list[str]:
    return sorted(set(CANONICAL.values()))
