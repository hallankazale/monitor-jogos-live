from __future__ import annotations

import os
import time
import unicodedata
from datetime import datetime
from functools import lru_cache
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from curl_cffi import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

SOFASCORE_BASE = "https://api.sofascore.com/api/v1"
TICKET_TZ = ZoneInfo("America/Cuiaba")
MAX_KICKOFF_DRIFT_SECONDS = 8 * 60 * 60

app = FastAPI(title="Monitor Jogos Live API", version="2.1.0")

allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

TRACKED: dict[str, dict[str, str]] = {
    "palmeiras-vasco": {"home": "Palmeiras", "away": "Vasco da Gama", "kickoff": "2026-08-23 15:00"},
    "man-city": {"home": "Manchester City", "away": "AFC Bournemouth", "kickoff": "2026-08-23 09:00"},
    "barcelona": {"home": "Elche", "away": "Barcelona", "kickoff": "2026-08-23 15:30"},
    "santos-mirassol": {"home": "Santos", "away": "Mirassol", "kickoff": "2026-08-23 17:30"},
    "bragantino-gremio": {"home": "Bragantino", "away": "Grêmio", "kickoff": "2026-08-23 15:00"},
    "chapecoense-sao-paulo": {"home": "Chapecoense", "away": "São Paulo", "kickoff": "2026-08-23 17:30"},
    "vitoria-bahia": {"home": "Vitória", "away": "Bahia", "kickoff": "2026-08-23 15:00"},
    "coritiba-corinthians": {"home": "Coritiba", "away": "Corinthians", "kickoff": "2026-08-23 18:30"},
    "porto-arouca": {"home": "FC Porto", "away": "Arouca", "kickoff": "2026-08-23 15:30"},
    "rennes-psg": {"home": "Rennes", "away": "Paris Saint-Germain", "kickoff": "2026-08-23 14:45"},
}


def normalize(text: str | None) -> str:
    text = text or ""
    normalized = unicodedata.normalize("NFD", text)
    chars = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return "".join(ch for ch in chars.lower() if ch.isalnum())


def same_team(actual: str | None, expected: str) -> bool:
    a, b = normalize(actual), normalize(expected)
    return bool(a and b) and (a == b or a in b or b in a)


def expected_timestamp(kickoff: str) -> int:
    dt = datetime.strptime(kickoff, "%Y-%m-%d %H:%M").replace(tzinfo=TICKET_TZ)
    return int(dt.timestamp())


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


@lru_cache(maxsize=64)
def resolve_team_id(team_name: str) -> int:
    payload = api_get(f"/search/all?q={quote(team_name)}&page=0")
    candidates: list[int] = []
    for result in payload.get("results", []):
        entity = result.get("entity") or {}
        sport = entity.get("sport") or {}
        if result.get("type") != "team" or sport.get("slug") != "football":
            continue
        entity_name = entity.get("name") or ""
        entity_id = entity.get("id")
        if entity_id is None:
            continue
        if normalize(entity_name) == normalize(team_name):
            return int(entity_id)
        if same_team(entity_name, team_name):
            candidates.append(int(entity_id))
    if candidates:
        return candidates[0]
    raise RuntimeError(f"Time não encontrado no Sofascore: {team_name}")


def event_matches(event: dict[str, Any], home: str, away: str) -> bool:
    home_name = (event.get("homeTeam") or {}).get("name")
    away_name = (event.get("awayTeam") or {}).get("name")
    return same_team(home_name, home) and same_team(away_name, away)


def fetch_team_events(team_id: int) -> list[dict[str, Any]]:
    events: dict[int, dict[str, Any]] = {}
    for direction in ("next", "last"):
        for page in (0, 1):
            payload = api_get(f"/team/{team_id}/events/{direction}/{page}", allow_404=True)
            for event in payload.get("events", []):
                event_id = event.get("id")
                if event_id is not None:
                    events[int(event_id)] = event
    return list(events.values())


def fetch_live_events() -> list[dict[str, Any]]:
    return api_get("/sport/football/events/live", allow_404=True).get("events", [])


def status_for(event: dict[str, Any]) -> str:
    status = event.get("status") or {}
    status_type = str(status.get("type") or "").lower()
    description = str(status.get("description") or "").lower()
    if status_type in {"finished", "afterpenalties", "afterextratime"}:
        return "FINISHED"
    if "half time" in description or status_type == "halftime":
        return "PAUSED"
    if status_type in {"inprogress", "live"} or any(token in description for token in ("1st half", "2nd half", "extra time", "penalties")):
        return "IN_PLAY"
    return "SCHEDULED"


def minute_for(event: dict[str, Any]) -> int | None:
    if status_for(event) not in {"IN_PLAY", "PAUSED"}:
        return None
    time_data = event.get("time") or {}
    started = time_data.get("currentPeriodStartTimestamp")
    if started is None:
        return None
    try:
        elapsed = max(0, int((time.time() - int(started)) // 60))
    except (TypeError, ValueError):
        return None
    description = str((event.get("status") or {}).get("description") or "").lower()
    if "2nd half" in description:
        elapsed += 45
    elif "extra time" in description:
        elapsed += 90
    return min(elapsed, 130)


def total_stat_value(payload: dict[str, Any], key: str) -> int | None:
    for period in payload.get("statistics", []):
        period_name = str(period.get("period") or "").upper()
        if period_name not in {"ALL", "MATCH", "FULLTIME", ""}:
            continue
        for group in period.get("groups", []):
            for item in group.get("statisticsItems", []):
                if item.get("key") != key:
                    continue
                home, away = item.get("homeValue"), item.get("awayValue")
                if home is None or away is None:
                    return None
                try:
                    return int(float(home) + float(away))
                except (TypeError, ValueError):
                    return None
    return None


def fetch_corners(event_id: int) -> int | None:
    try:
        return total_stat_value(api_get(f"/event/{event_id}/statistics", allow_404=True), "cornerKicks")
    except Exception:
        return None


def fetch_red_cards(event_id: int) -> int | None:
    try:
        incidents = api_get(f"/event/{event_id}/incidents", allow_404=True).get("incidents")
    except Exception:
        return None
    if incidents is None:
        return None
    total = 0
    for incident in incidents:
        if incident.get("incidentType") != "card" or incident.get("rescinded"):
            continue
        if "red" in str(incident.get("incidentClass") or "").lower():
            total += 1
    return total


def match_payload(event: dict[str, Any], expected_kickoff: int) -> dict[str, Any]:
    event_id = int(event["id"])
    actual_kickoff = event.get("startTimestamp")
    home_team = event.get("homeTeam") or {}
    away_team = event.get("awayTeam") or {}
    return {
        "status": status_for(event),
        "minute": minute_for(event),
        "homeScore": (event.get("homeScore") or {}).get("current"),
        "awayScore": (event.get("awayScore") or {}).get("current"),
        "corners": fetch_corners(event_id),
        "redCards": fetch_red_cards(event_id),
        "updatedAt": int(time.time()),
        "source": "Sofascore direct",
        "eventId": event_id,
        "kickoffTimestamp": actual_kickoff,
        "kickoffDriftMinutes": round(abs(int(actual_kickoff) - expected_kickoff) / 60) if actual_kickoff else None,
        "fixtureValidated": bool(actual_kickoff and abs(int(actual_kickoff) - expected_kickoff) <= MAX_KICKOFF_DRIFT_SECONDS),
        "homeTeamId": home_team.get("id"),
        "awayTeamId": away_team.get("id"),
    }


def find_tracked_event(home: str, away: str, kickoff: str, live_events: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, int]:
    target = expected_timestamp(kickoff)
    pool: dict[int, dict[str, Any]] = {}

    for event in live_events:
        if event_matches(event, home, away) and event.get("id") is not None:
            pool[int(event["id"])] = event

    home_id = resolve_team_id(home)
    for event in fetch_team_events(home_id):
        if event_matches(event, home, away) and event.get("id") is not None:
            pool[int(event["id"])] = event

    candidates = [event for event in pool.values() if event.get("startTimestamp") is not None]
    if not candidates:
        return None, target

    best = min(candidates, key=lambda event: abs(int(event["startTimestamp"]) - target))
    if abs(int(best["startTimestamp"]) - target) > MAX_KICKOFF_DRIFT_SECONDS:
        return None, target
    return best, target


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "message": "Monitor Jogos Live API", "health": "/health", "matches": "/matches"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": "Sofascore direct", "fixture_validation": "opponent+kickoff"}


@app.get("/matches")
def matches() -> dict[str, Any]:
    try:
        live_events = fetch_live_events()
        result: dict[str, Any] = {}
        errors: dict[str, str] = {}
        for key, cfg in TRACKED.items():
            try:
                event, target = find_tracked_event(cfg["home"], cfg["away"], cfg["kickoff"], live_events)
                result[key] = match_payload(event, target) if event else None
                if event is None:
                    errors[key] = "Confronto correto não encontrado dentro da janela de horário esperada"
            except Exception as exc:
                result[key] = None
                errors[key] = str(exc)
        return {"matches": result, "provider": "Sofascore direct", "errors": errors}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao consultar a fonte esportiva: {exc}") from exc
