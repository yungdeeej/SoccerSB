"""Transfermarkt market value scraper — defensive, weekly cadence.

Anti-bot posture: realistic User-Agent, 2.5s sleep between requests, graceful 403
handling. Failure mode: keep cached values (max 30 days stale during tournament).
"""
from __future__ import annotations

import re
import time

import httpx
from bs4 import BeautifulSoup

from data.db import connect, log_agent_run

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)
SLEEP_BETWEEN_REQUESTS_S = 2.5

# Transfermarkt national team page slugs per short_name
TM_SLUGS: dict[str, tuple[str, int]] = {
    "MEX": ("mexiko", 6303), "RSA": ("suedafrika", 14924), "KOR": ("suedkorea", 3589),
    "CZE": ("tschechien", 3445), "CAN": ("kanada", 3510), "BIH": ("bosnien-herzegowina", 3446),
    "QAT": ("katar", 3588), "SUI": ("schweiz", 3384), "BRA": ("brasilien", 3439),
    "MAR": ("marokko", 3575), "HAI": ("haiti", 3651), "SCO": ("schottland", 3380),
    "USA": ("vereinigte-staaten", 3505), "PAR": ("paraguay", 3437), "AUS": ("australien", 3433),
    "TUR": ("turkei", 3381), "GER": ("deutschland", 3262), "CUW": ("curacao", 21303),
    "CIV": ("elfenbeinkuste", 3591), "ECU": ("ecuador", 3563), "NED": ("niederlande", 3379),
    "JPN": ("japan", 3435), "SWE": ("schweden", 3557), "TUN": ("tunesien", 3670),
    "BEL": ("belgien", 3382), "EGY": ("agypten", 3672), "IRN": ("iran", 3582),
    "NZL": ("neuseeland", 3508), "ESP": ("spanien", 3375), "CPV": ("kap-verde", 4128),
    "KSA": ("saudi-arabien", 3807), "URU": ("uruguay", 3449), "FRA": ("frankreich", 3377),
    "SEN": ("senegal", 3499), "IRQ": ("irak", 3586), "NOR": ("norwegen", 3440),
    "ARG": ("argentinien", 3437), "ALG": ("algerien", 3614), "AUT": ("osterreich", 3383),
    "JOR": ("jordanien", 3601), "POR": ("portugal", 3300), "COD": ("dr-kongo", 3854),
    "UZB": ("usbekistan", 3593), "COL": ("kolumbien", 3816), "ENG": ("england", 3299),
    "CRO": ("kroatien", 3556), "GHA": ("ghana", 3441), "PAN": ("panama", 3577),
}


def parse_market_value_eur_m(text: str) -> float | None:
    """Parse Transfermarkt value strings like '€1.02bn' / '€480.50m' / '€950k'."""
    m = re.search(r"€\s*([\d.,]+)\s*(bn|m|k)", text, re.IGNORECASE)
    if not m:
        return None
    value = float(m.group(1).replace(",", "."))
    unit = m.group(2).lower()
    if unit == "bn":
        return value * 1000
    if unit == "m":
        return value
    return value / 1000


def fetch_squad_value(short_name: str, client: httpx.Client) -> float | None:
    slug_entry = TM_SLUGS.get(short_name)
    if not slug_entry:
        return None
    slug, tm_id = slug_entry
    url = f"https://www.transfermarkt.com/{slug}/startseite/verein/{tm_id}"
    resp = client.get(url)
    if resp.status_code in (403, 429):
        raise PermissionError(f"Transfermarkt blocked request ({resp.status_code}) for {short_name}")
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    # Total market value appears in the header value element
    for el in soup.select("a.data-header__market-value-wrapper, div.data-header__box--small"):
        value = parse_market_value_eur_m(el.get_text(" ", strip=True))
        if value is not None:
            return value
    return parse_market_value_eur_m(soup.get_text(" ", strip=True)[:5000])


def update_market_values(short_names: list[str] | None = None) -> dict[str, object]:
    """Scrape squad market values; persist; log. Stops early on hard blocks."""
    start = time.monotonic()
    updated = 0
    failed: list[str] = []
    blocked = False
    try:
        with connect() as conn:
            rows = conn.execute("SELECT short_name FROM teams ORDER BY short_name").fetchall()
            targets = [r["short_name"] for r in rows if short_names is None or r["short_name"] in short_names]

        with httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"},
            timeout=25,
            follow_redirects=True,
        ) as client:
            for code in targets:
                try:
                    value = fetch_squad_value(code, client)
                    if value is not None:
                        with connect() as conn:
                            conn.execute(
                                "UPDATE teams SET market_value_squad_eur_m = %s, "
                                "market_value_last_updated = NOW(), updated_at = NOW() "
                                "WHERE short_name = %s",
                                (value, code),
                            )
                        updated += 1
                    else:
                        failed.append(code)
                except PermissionError:
                    blocked = True
                    failed.append(code)
                    break  # Cloudflare block — stop hammering
                except Exception:
                    failed.append(code)
                time.sleep(SLEEP_BETWEEN_REQUESTS_S)

        duration = int((time.monotonic() - start) * 1000)
        summary: dict[str, object] = {
            "source": "transfermarkt",
            "teams_updated": updated,
            "failed": failed,
            "blocked": blocked,
        }
        status = "success" if updated > 0 and not blocked else "failed_recoverable"
        log_agent_run("data_load_transfermarkt", status, duration, outputs_summary=summary)
        return summary
    except Exception as err:
        log_agent_run(
            "data_load_transfermarkt",
            "failed_recoverable",
            int((time.monotonic() - start) * 1000),
            error=err,
        )
        raise
