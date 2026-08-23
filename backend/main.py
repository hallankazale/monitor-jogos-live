from __future__ import annotations

import os
import time
import unicodedata
from datetime import datetime
from functools import lru_cache
from typing import Any, Literal
from urllib.parse import quote
from zoneinfo import ZoneInfo

from curl_cffi import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .discovery import router as discovery_router

SOFASCORE_BASE = "https://api.sofascore.com/api/v1"
TICKET_TZ = ZoneInfo("America/Cuiaba")
MAX_KICKOFF_DRIFT_SECONDS = 8 * 60 * 60

app = FastAPI(title="Monitor Jogos Live API", version="3.2.0")
allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])
app.include_router(discovery_router)

class ConditionIn(BaseModel):
    type: Literal["goals_over", "corners_over", "reds_under", "winner"]
    value: float | None = None
    team: str | None = None
    label: str = Field(min_length=1, max_length=120)

class SelectionIn(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    home: str = Field(min_length=1, max_length=80)
    away: str = Field(min_length=1, max_length=80)
    kickoff: str
    conditions: list[ConditionIn] = Field(default_factory=list, max_length=12)

class TicketTrackRequest(BaseModel):
    name: str = Field(default="Meu bilhete", max_length=80)
    selections: list[SelectionIn] = Field(min_length=1, max_length=40)

def normalize(text: str | None) -> str:
    normalized = unicodedata.normalize("NFD", text or "")
    chars = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return "".join(ch for ch in chars.lower() if ch.isalnum())

def same_team(actual: str | None, expected: str) -> bool:
    a, b = normalize(actual), normalize(expected)
    return bool(a and b) and (a == b or a in b or b in a)

def expected_timestamp(kickoff: str) -> int:
    return int(datetime.strptime(kickoff, "%Y-%m-%d %H:%M").replace(tzinfo=TICKET_TZ).timestamp())

def api_get(path: str, *, allow_404: bool = False) -> dict[str, Any]:
    response = requests.get(f"{SOFASCORE_BASE}{path}", impersonate="chrome", timeout=12, headers={"Accept":"application/json","Referer":"https://www.sofascore.com/","Origin":"https://www.sofascore.com","X-Requested-With":"XMLHttpRequest"})
    if allow_404 and response.status_code == 404:
        return {}
    response.raise_for_status()
    return response.json()

@lru_cache(maxsize=128)
def resolve_team_id(team_name: str) -> int:
    payload = api_get(f"/search/all?q={quote(team_name)}&page=0")
    candidates=[]
    for result in payload.get("results", []):
        entity=result.get("entity") or {}; sport=entity.get("sport") or {}
        if result.get("type") != "team" or sport.get("slug") != "football" or entity.get("id") is None: continue
        if normalize(entity.get("name")) == normalize(team_name): return int(entity["id"])
        if same_team(entity.get("name"), team_name): candidates.append(int(entity["id"]))
    if candidates: return candidates[0]
    raise RuntimeError(f"Time não encontrado: {team_name}")

def event_matches(event, home, away):
    return same_team((event.get("homeTeam") or {}).get("name"), home) and same_team((event.get("awayTeam") or {}).get("name"), away)

def fetch_team_events(team_id):
    events={}
    for direction in ("next","last"):
        for page in (0,1):
            try: payload=api_get(f"/team/{team_id}/events/{direction}/{page}", allow_404=True)
            except Exception: continue
            for event in payload.get("events",[]):
                if event.get("id") is not None: events[int(event["id"])]=event
    return list(events.values())

def status_for(event):
    t=str((event.get("status") or {}).get("type") or "").lower()
    if t in {"finished","afterpenalties","afterextratime"}: return "FINISHED"
    if t in {"inprogress","live"}: return "IN_PLAY"
    return "SCHEDULED"

def find_event(cfg):
    target=expected_timestamp(cfg.kickoff)
    team_id=resolve_team_id(cfg.home)
    candidates=[e for e in fetch_team_events(team_id) if event_matches(e,cfg.home,cfg.away) and e.get("startTimestamp")]
    if not candidates: return None,target
    best=min(candidates,key=lambda e:abs(int(e["startTimestamp"])-target))
    return (best if abs(int(best["startTimestamp"])-target)<=MAX_KICKOFF_DRIFT_SECONDS else None),target

def safe_match_payload(event, target):
    if not event: return None
    return {"status":status_for(event),"minute":None,"homeScore":(event.get("homeScore") or {}).get("current"),"awayScore":(event.get("awayScore") or {}).get("current"),"corners":None,"redCards":None,"updatedAt":int(time.time()),"source":"Sofascore","eventId":event.get("id"),"fixtureValidated":True}

def track_configs(configs):
    result={}; errors={}
    for cfg in configs:
        try:
            event,target=find_event(cfg)
            result[cfg.id]=safe_match_payload(event,target)
            if event is None: errors[cfg.id]="Partida ainda não localizada na fonte esportiva"
        except Exception as exc:
            # Provider failures are isolated per selection; one blocked request must not kill the ticket.
            result[cfg.id]={"status":"UNAVAILABLE","minute":None,"homeScore":None,"awayScore":None,"corners":None,"redCards":None,"updatedAt":int(time.time()),"source":"provider-unavailable","fixtureValidated":False}
            errors[cfg.id]=f"Fonte temporariamente indisponível: {exc}"
    return result,errors

@app.get("/")
def root(): return {"status":"ok","message":"Monitor Jogos Live API","health":"/health","track":"/track","discover":"/discover/upcoming"}

@app.get("/health")
def health(): return {"status":"ok","provider":"resilient","fixture_validation":"opponent+kickoff"}

@app.post("/track")
def track_ticket(ticket: TicketTrackRequest):
    matches,errors=track_configs(ticket.selections)
    return {"ticket":ticket.name,"matches":matches,"provider":"resilient","errors":errors,"degraded":bool(errors)}
