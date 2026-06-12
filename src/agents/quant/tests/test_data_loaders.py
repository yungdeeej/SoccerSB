"""Data loader tests — parsing + error handling with mocked transports."""
from __future__ import annotations

import httpx
import pytest

from data.elo_loader import fetch_elo_table
from data.team_names import all_short_names, resolve_team_code
from data.transfermarkt_loader import parse_market_value_eur_m


class TestTeamNames:
    def test_resolves_eloratings_spellings(self) -> None:
        assert resolve_team_code("South Korea") == "KOR"
        assert resolve_team_code("Türkiye") == "TUR"
        assert resolve_team_code("Cape Verde") == "CPV"
        assert resolve_team_code("DR Congo") == "COD"

    def test_unknown_returns_none(self) -> None:
        assert resolve_team_code("Narnia") is None

    def test_covers_all_48(self) -> None:
        assert len(all_short_names()) == 48


class TestEloLoader:
    def make_client(self, handler: httpx.MockTransport) -> httpx.Client:
        return httpx.Client(transport=handler, base_url="https://eloratings.net")

    def test_parses_valid_tsv(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            if "teams" in request.url.path:
                return httpx.Response(200, text="ES\tSpain\nBR\tBrazil\nXX\tNarnia")
            return httpx.Response(
                200,
                text="1\t1\tES\t2157\textra\n2\t2\tBR\t1991\textra\n3\t3\tXX\t1500\textra",
            )

        client = self.make_client(httpx.MockTransport(respond))
        ratings = fetch_elo_table(client)
        assert ratings == {"ESP": 2157.0, "BRA": 1991.0}  # Narnia dropped

    def test_http_error_raises(self) -> None:
        client = self.make_client(httpx.MockTransport(lambda _: httpx.Response(500)))
        with pytest.raises(httpx.HTTPStatusError):
            fetch_elo_table(client)

    def test_malformed_rows_skipped(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            if "teams" in request.url.path:
                return httpx.Response(200, text="ES\tSpain")
            return httpx.Response(200, text="garbage\nnot\ttsv\n1\t1\tES\tNaN-ish\n1\t1\tES\t2100")

        client = self.make_client(httpx.MockTransport(respond))
        ratings = fetch_elo_table(client)
        assert ratings == {"ESP": 2100.0}


class TestTransfermarktParsing:
    def test_parses_billions(self) -> None:
        assert parse_market_value_eur_m("Total market value €1.02bn") == pytest.approx(1020.0)

    def test_parses_millions(self) -> None:
        assert parse_market_value_eur_m("€480.50m") == pytest.approx(480.5)

    def test_parses_thousands(self) -> None:
        assert parse_market_value_eur_m("€950k") == pytest.approx(0.95)

    def test_no_value_returns_none(self) -> None:
        assert parse_market_value_eur_m("no value here") is None
