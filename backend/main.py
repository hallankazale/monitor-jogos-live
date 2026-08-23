from __future__ import annotations

import os
import unicodedata
from datetime import date
from typing import Any

import esd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Monitor Jogos Live API", version="1.0.0")

allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

client = esd.SofascoreClient()

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
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn").lower().replace(" ", "").replace("-", "")


def same_team(actual: str, expected: str) -> bool:
    a, b = normalize(actual), normalize(expected)
    return a == b or a in b or b in a


def event_matches(event: Any, home: str, away: str) -> bool:
    return same_team(event.home_team.name, home) and same_team(event.away_team.name, away)


def status_for(event: Any) -> str:
    description = (getattr(getattr(event, "status", None), "description", "") or "").lower()
    if any(token in description for token in ("finished", "ended", "after penalties", "full time")):
        return "FINISHED"
    if "half" in description and "time" in description:
        return "PAUSED"
    if any(token in description for token in ("1st half", "2nd half", "extra time", "penalties", "in progress")):
        return "IN_PLAY"
    return "SCHEDULED"


def sum_stat(item: Any) -> int | None:
    if item is None:
        return None
    home = getattr(item, "home_value", None)
    away = getattr(item, "away_value", None)
    if home is None or away is None:
        return None
    try:
        return int(float(home) + float(away))
    except (TypeError, ValueError):
        return None


def count_red_cards(event_id: int) -> int | None:
    try:
        incidents = client.get_match_incidents(event_id)
    except Exception:
        return None

    count = 0
    for incident in incidents:
        incident_type = getattr(getattr(incident, "type", None), "value", getattr(incident, "type", None))
        if incident_type != "card" or getattr(incident, "rescinded", False):
            continue
        details = (getattr(incident, "details", "") or "").lower()
        if "red" in details:
            count += 1
    return count


def match_payload(event: Any) -> dict[str, Any]:
    corners = None
    try:
        details = client.get_match_stats(event.id)
        if getattr(details, "all", None) is not None:
            corners = sum_stat(details.all.match_overview.corner_kicks)
    except Exception:
        pass

    return {
        "status": status_for(event),
        "minute": getattr(event, "total_elapsed_minutes", None),
        "homeScore": getattr(getattr(event, "home_score", None), "current", None),
        "awayScore": getattr(getattr(event, "away_score", None), "current", None),
        "corners": corners,
        "redCards": count_red_cards(event.id),
        "updatedAt": date.today().isoformat(),
        "source": "EasySoccerData/Sofascore",
        "eventId": event.id,
    }


def get_today_events() -> list[Any]:
    # A lista do dia mantém jogos encerrados; a lista live melhora a precisão do minuto.
    scheduled = client.get_events(date.today().isoformat())
    try:
        live = client.get_events(live=True)
    except Exception:
        live = []

    by_id = {event.id: event for event in scheduled}
    for event in live:
        by_id[event.id] = event
    return list(by_id.values())


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": "EasySoccerData/Sofascore"}


@app.get("/matches")
def matches() -> dict[str, Any]:
    try:
        events = get_today_events()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao consultar a fonte esportiva: {exc}") from exc

    result: dict[str, Any] = {}
    for key, (home, away) in TRACKED.items():
        event = next((item for item in events if event_matches(item, home, away)), None)
        result[key] = match_payload(event) if event else None

    return {"matches": result, "provider": "EasySoccerData/Sofascore"}
