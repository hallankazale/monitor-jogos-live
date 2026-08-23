from __future__ import annotations

import os
import time
import unicodedata
from functools import lru_cache
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from curl_cffi import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

SOFASCORE_BASE = "https://api.sofascore.com/api/v1"
BRAZIL_TZ = ZoneInfo("America/Sao_Paulo")

app = FastAPI(title="Monitor Jogos Live API", version="2.0.0")

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

TRACKED = {
    "palmeiras-vasco": ("Palmeiras", "Vasco da Gama"),
    "man-city": ("Manchester City", "AFC Bournemouth"),
    "barcelona": ("Elche", "Barcelona"),
    "santos-mirassol": ("Santos", "Mirassol"),
    "bragantino-gremio": ("Bragantino", "Grêmio"),
    "chapecoense-sao-paulo": ("Chapecoense", "São Paulo"),
    "vitoria-bahia": ("Vitória", "Bahia"),
    "coritiba-corinthians": ("Coritiba", "Corinthians"),
    "porto-arouca": ("FC Porto", "Arouca"),
    "rennes-psg": ("Rennes", "Paris Saint-Germain"),
}


def normalize(text: str | None) -> str:
    text = text or ""
    normalized = unicodedata.normalize("NFD", text)
    chars = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return "".join(ch for ch in chars.lower() if ch.isalnum())


def same_team(actual: str | None, expected: str) -> bool:
    a, b = normalize(actual), normalize(expected)
    return bool(a and b) and (a == b or a in b or b in a)


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
    candidates: list[tuple[int, str]] = []

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
            candidates.append((int(entity_id), entity_name))

    if candidates:
        return candidates[0][0]
    raise RuntimeError(f"Time não encontrado no Sofascore: {team_name}")


def event_matches(event: dict[str, Any], home: str, away: str) -> bool:
    home_name = (event.get("homeTeam") or {}).get("name")
    away_name = (event.get("awayTeam") or {}).get("name")
    return same_team(home_name, home) and same_team(away_name, away)


def fetch_team_events(team_id: int) -> list[dict[str, Any]]:
    events: dict[int, dict[str, Any]] = {}
    for direction in ("next", "last"):
        payload = api_get(f"/team/{team_id}/events/{direction}/0", allow_404=True)
        for event in payload.get("events", []):
            event_id = event.get("id")
            if event_id is not None:
                events[int(event_id)] = event
    return list(events.values())


def fetch_live_events() -> list[dict[str, Any]]:
    payload = api_get("/sport/football/events/live", allow_404=True)
    return payload.get("events", [])


def status_for(event: dict[str, Any]) -> str:
    status = event.get("status") or {}
    status_type = str(status.get("type") or "").lower()
    description = str(status.get("description") or "").lower()

    if status_type in {"finished", "afterpenalties", "afterextratime"}:
        return "FINISHED"
    if "half time" in description or status_type == "halftime":
        return "PAUSED"
    if status_type in {"inprogress", "live"} or any(
        token in description
        for token in ("1st half", "2nd half", "extra time", "penalties")
    ):
        return "IN_PLAY"
    return "SCHEDULED"


def minute_for(event: dict[str, Any]) -> int | None:
    status = status_for(event)
    if status not in {"IN_PLAY", "PAUSED"}:
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
                home = item.get("homeValue")
                away = item.get("awayValue")
                if home is None or away is None:
                    return None
                try:
                    return int(float(home) + float(away))
                except (TypeError, ValueError):
                    return None
    return None


def fetch_corners(event_id: int) -> int | None:
    try:
        payload = api_get(f"/event/{event_id}/statistics", allow_404=True)
        return total_stat_value(payload, "cornerKicks")
    except Exception:
        return None


def fetch_red_cards(event_id: int) -> int | None:
    try:
        payload = api_get(f"/event/{event_id}/incidents", allow_404=True)
    except Exception:
        return None

    incidents = payload.get("incidents")
    if incidents is None:
        return None

    total = 0
    for incident in incidents:
        if incident.get("incidentType") != "card" or incident.get("rescinded"):
            continue
        card_class = str(incident.get("incidentClass") or "").lower()
        if "red" in card_class:
            total += 1
    return total


def match_payload(event: dict[str, Any]) -> dict[str, Any]:
    event_id = int(event["id"])
    home_score = (event.get("homeScore") or {}).get("current")
    away_score = (event.get("awayScore") or {}).get("current")

    return {
        "status": status_for(event),
        "minute": minute_for(event),
        "homeScore": home_score,
        "awayScore": away_score,
        "corners": fetch_corners(event_id),
        "redCards": fetch_red_cards(event_id),
        "updatedAt": int(time.time()),
        "source": "Sofascore direct",
        "eventId": event_id,
    }


def find_tracked_event(
    home: str,
    away: str,
    live_events: list[dict[str, Any]],
) -> dict[str, Any] | None:
    event = next((item for item in live_events if event_matches(item, home, away)), None)
    if event:
        return event

    home_id = resolve_team_id(home)
    candidates = fetch_team_events(home_id)
    return next((item for item in candidates if event_matches(item, home, away)), None)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "status": "ok",
        "message": "Monitor Jogos Live API",
        "health": "/health",
        "matches": "/matches",
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": "Sofascore direct"}


@app.get("/matches")
def matches() -> dict[str, Any]:
    try:
        live_events = fetch_live_events()
        result: dict[str, Any] = {}
        errors: dict[str, str] = {}

        for key, (home, away) in TRACKED.items():
            try:
                event = find_tracked_event(home, away, live_events)
                result[key] = match_payload(event) if event else None
            except Exception as exc:
                result[key] = None
                errors[key] = str(exc)

        return {
            "matches": result,
            "provider": "Sofascore direct",
            "errors": errors,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Falha ao consultar a fonte esportiva: {exc}",
        ) from exc
