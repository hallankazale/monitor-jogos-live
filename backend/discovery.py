from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from curl_cffi import requests
from fastapi import APIRouter, Query

SOFASCORE_BASE = "https://api.sofascore.com/api/v1"
TICKET_TZ = ZoneInfo("America/Cuiaba")

router = APIRouter(prefix="/discover", tags=["discover"])


def api_get(path: str, *, allow_404: bool = False) -> dict[str, Any]:
    response = requests.get(
        f"{SOFASCORE_BASE}{path}",
        impersonate="chrome",
        timeout=15,
        headers={"Accept": "application/json"},
    )
    if allow_404 and response.status_code == 404:
        return {}
    response.raise_for_status()
    return response.json()


def scheduled_events(date: str) -> list[dict[str, Any]]:
    payload = api_get(f"/sport/football/scheduled-events/{date}", allow_404=True)
    return payload.get("events", [])


def event_to_item(event: dict[str, Any]) -> dict[str, Any]:
    tournament = event.get("tournament") or {}
    unique_tournament = tournament.get("uniqueTournament") or {}
    category = tournament.get("category") or unique_tournament.get("category") or {}
    home = event.get("homeTeam") or {}
    away = event.get("awayTeam") or {}
    timestamp = event.get("startTimestamp")
    local_dt = datetime.fromtimestamp(int(timestamp), TICKET_TZ) if timestamp else None
    return {
        "eventId": event.get("id"),
        "home": home.get("name"),
        "away": away.get("name"),
        "homeTeamId": home.get("id"),
        "awayTeamId": away.get("id"),
        "startTimestamp": timestamp,
        "date": local_dt.strftime("%Y-%m-%d") if local_dt else None,
        "time": local_dt.strftime("%H:%M") if local_dt else None,
        "league": unique_tournament.get("name") or tournament.get("name") or "Competição",
        "leagueId": unique_tournament.get("id") or tournament.get("id"),
        "country": category.get("name") or "Internacional",
        "countryCode": category.get("alpha2"),
        "status": (event.get("status") or {}).get("type") or "notstarted",
    }


def search_entities(query: str, limit: int) -> list[dict[str, Any]]:
    payload = api_get(f"/search/all?q={quote(query)}&page=0", allow_404=True)
    items: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()

    for result in payload.get("results", []):
        entity = result.get("entity") or {}
        sport = entity.get("sport") or {}
        if sport.get("slug") != "football":
            continue

        result_type = str(result.get("type") or "")
        if result_type not in {"team", "uniqueTournament", "tournament"}:
            continue

        entity_id = entity.get("id")
        if entity_id is None:
            continue
        kind = "team" if result_type == "team" else "league"
        key = (kind, int(entity_id))
        if key in seen:
            continue
        seen.add(key)

        category = entity.get("category") or {}
        items.append(
            {
                "type": kind,
                "id": int(entity_id),
                "name": entity.get("name"),
                "country": category.get("name") or (entity.get("country") or {}).get("name"),
                "slug": entity.get("slug"),
            }
        )
        if len(items) >= limit:
            break
    return items


def team_upcoming(team_id: int, pages: int = 2) -> list[dict[str, Any]]:
    events: dict[int, dict[str, Any]] = {}
    for page in range(pages):
        payload = api_get(f"/team/{team_id}/events/next/{page}", allow_404=True)
        for event in payload.get("events", []):
            event_id = event.get("id")
            if event_id is not None:
                events[int(event_id)] = event
    return list(events.values())


@router.get("/search")
def autocomplete(
    q: str = Query(min_length=2, max_length=80),
    limit: int = Query(default=10, ge=1, le=20),
) -> dict[str, Any]:
    return {"query": q, "results": search_entities(q, limit)}


@router.get("/upcoming")
def upcoming(
    date: str | None = Query(default=None, description="YYYY-MM-DD"),
    q: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=15, ge=1, le=50),
) -> dict[str, Any]:
    selected_date = date or datetime.now(TICKET_TZ).strftime("%Y-%m-%d")
    events: dict[int, dict[str, Any]] = {}
    source = "global-schedule"
    query = (q or "").strip()

    if query:
        entities = search_entities(query, 10)
        team_ids = [item["id"] for item in entities if item["type"] == "team"][:5]
        if team_ids:
            source = "team-search"
            for team_id in team_ids:
                for event in team_upcoming(team_id):
                    event_id = event.get("id")
                    if event_id is not None:
                        events[int(event_id)] = event
        else:
            source = "league-filter"
            for event in scheduled_events(selected_date):
                event_id = event.get("id")
                if event_id is not None:
                    events[int(event_id)] = event
    else:
        for event in scheduled_events(selected_date):
            event_id = event.get("id")
            if event_id is not None:
                events[int(event_id)] = event

    items = [event_to_item(event) for event in events.values()]

    if query:
        needle = query.lower()
        items = [
            item for item in items
            if needle in str(item.get("home") or "").lower()
            or needle in str(item.get("away") or "").lower()
            or needle in str(item.get("league") or "").lower()
            or needle in str(item.get("country") or "").lower()
        ]

    items.sort(key=lambda item: item.get("startTimestamp") or 0)
    items = items[:limit]
    return {
        "date": selected_date,
        "query": query,
        "count": len(items),
        "limit": limit,
        "scope": "all Sofascore football leagues",
        "source": source,
        "events": items,
    }
