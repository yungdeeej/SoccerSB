"""Venue factor — host nation boost, altitude, travel asymmetry (02_AGENT_QUANT.md)."""
from __future__ import annotations

import math

from model.params import load_capitals
from model.types import ModelParams, VenueInfo

HOST_COUNTRY_BY_TEAM = {"MEX": "Mexico", "USA": "United States", "CAN": "Canada"}


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def is_host_at_home(team_code: str, venue: VenueInfo) -> bool:
    host_country = HOST_COUNTRY_BY_TEAM.get(team_code)
    return host_country is not None and venue.country is not None and host_country == venue.country


def is_acclimated_to_altitude(team_code: str) -> bool:
    """Capital-altitude proxy: teams based >= 1500m are altitude-acclimated."""
    cap = load_capitals().get(team_code)
    return cap is not None and cap.get("altitude_m", 0) >= 1500


def venue_factor(
    venue: VenueInfo,
    home_code: str,
    away_code: str,
    params: ModelParams,
    generic_host: str | None = None,
) -> float:
    """
    Multiplicative factor applied to home lambda (inverse applied to away).
    generic_host: short_name of the historical host nation for backtests.
    """
    factor = 1.0

    # Host nation playing at home
    host_home = is_host_at_home(home_code, venue)
    host_away = is_host_at_home(away_code, venue)
    if generic_host is not None:
        # Backtest mode: host boost configured generically
        if home_code == generic_host:
            factor *= params.generic_host_boost
            host_home = True
        elif away_code == generic_host:
            factor /= params.generic_host_boost
            host_away = True
    else:
        if host_home:
            factor *= params.host_boosts.get(home_code, params.generic_host_boost)
        elif host_away:
            factor /= params.host_boosts.get(away_code, params.generic_host_boost)

    # Altitude swing
    if venue.is_high_altitude or venue.altitude_meters >= 1500:
        home_acc = is_acclimated_to_altitude(home_code)
        away_acc = is_acclimated_to_altitude(away_code)
        swing = (
            params.altitude_2000plus_swing
            if venue.altitude_meters >= 2000
            else params.altitude_1500_2000_swing
        )
        if home_acc and not away_acc:
            factor *= 1.0 + swing
        elif away_acc and not home_acc:
            factor *= 1.0 - swing

    # Travel asymmetry on fully neutral matches
    if not host_home and not host_away and venue.latitude is not None and venue.longitude is not None:
        capitals = load_capitals()
        home_cap = capitals.get(home_code)
        away_cap = capitals.get(away_code)
        if home_cap and away_cap:
            home_travel = haversine_km(home_cap["lat"], home_cap["lng"], venue.latitude, venue.longitude)
            away_travel = haversine_km(away_cap["lat"], away_cap["lng"], venue.latitude, venue.longitude)
            diff_km = away_travel - home_travel
            if abs(diff_km) >= 500:
                advantage = min(params.travel_advantage_cap, abs(diff_km) * params.travel_advantage_per_1000km / 1000)
                factor *= (1.0 + advantage) if diff_km > 0 else (1.0 - advantage)

    return factor
