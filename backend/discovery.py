from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from curl_cffi import requests
from fastapi import APIRouter, Query

SOFASCORE_BASES = (
    "https://api.sofascore.com/api/v1",
    "https://api.sofascore.app/api/v1",
    "https://www.sofascore.com/api/v1",
)
TICKET_TZ = ZoneInfo("America/Cuiaba")
router = APIRouter(prefix="/discover", tags=["discover"])

_original_get = requests.get

def _xhr_get(url: str, *args: Any, **kwargs: Any):
    headers = dict(kwargs.pop("headers", {}) or {})
    headers.setdefault("Accept", "application/json, text/plain, */*")
    headers.setdefault("X-Requested-With", "XMLHttpRequest")
    headers.setdefault("Referer", "https://www.sofascore.com/")
    headers.setdefault("Origin", "https://www.sofascore.com")
    kwargs["headers"] = headers
    return _original_get(url, *args, **kwargs)

requests.get = _xhr_get

def api_get(path: str, *, allow_404: bool = False) -> dict[str, Any]:
    last_error: Exception | None = None
    for base in SOFASCORE_BASES:
        try:
            response = requests.get(f"{base}{path}", impersonate="chrome", timeout=15)
            if allow_404 and response.status_code == 404:
                return {}
            if response.status_code in {403, 429, 503}:
                last_error = RuntimeError(f"Sofascore bloqueou {base} com HTTP {response.status_code}")
                continue
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last_error = exc
    if last_error:
        raise last_error
    return {}

def scheduled_events(date: str) -> list[dict[str, Any]]:
    payload = api_get(f"/sport/football/scheduled-events/{date}", allow_404=True)
    return payload.get("events", [])

def event_to_item(event: dict[str, Any]) -> dict[str, Any]:
    tournament = event.get("tournament") or {}
    unique_tournament = tournament.get("uniqueTournament") or {}
    category = tournament.get("category") or unique_tournament.get("category") or {}
    home, away = event.get("homeTeam") or {}, event.get("awayTeam") or {}
    timestamp = event.get("startTimestamp")
    local_dt = datetime.fromtimestamp(int(timestamp), TICKET_TZ) if timestamp else None
    return {"eventId":event.get("id"),"home":home.get("name"),"away":away.get("name"),"homeTeamId":home.get("id"),"awayTeamId":away.get("id"),"startTimestamp":timestamp,"date":local_dt.strftime("%Y-%m-%d") if local_dt else None,"time":local_dt.strftime("%H:%M") if local_dt else None,"league":unique_tournament.get("name") or tournament.get("name") or "Competição","leagueId":unique_tournament.get("id") or tournament.get("id"),"country":category.get("name") or "Internacional","countryCode":category.get("alpha2"),"status":(event.get("status") or {}).get("type") or "notstarted"}

def team_variant(name: str) -> str:
    lower=f" {name.lower()} "
    if any(t in lower for t in (" u20 "," sub-20 "," sub 20 ")): return "Sub-20"
    if any(t in lower for t in (" u23 "," sub-23 "," sub 23 ")): return "Sub-23"
    if any(t in lower for t in (" u17 "," sub-17 "," sub 17 ")): return "Sub-17"
    if any(t in lower for t in (" women "," feminino "," feminina ")): return "Feminino"
    if any(t in lower for t in (" reserves "," reserva ")) or name.endswith(" B"): return "Reserva/B"
    return "Principal"

def search_entities(query: str, limit: int) -> list[dict[str, Any]]:
    payload=api_get(f"/search/all?q={quote(query)}&page=0", allow_404=True)
    items=[]; seen=set()
    for result in payload.get("results",[]):
        entity=result.get("entity") or {}; sport=entity.get("sport") or {}
        if sport.get("slug")!="football": continue
        result_type=str(result.get("type") or "")
        if result_type not in {"team","uniqueTournament","tournament"}: continue
        entity_id=entity.get("id")
        if entity_id is None: continue
        kind="team" if result_type=="team" else "league"; key=(kind,int(entity_id))
        if key in seen: continue
        seen.add(key); category=entity.get("category") or {}; name=entity.get("name") or ""
        items.append({"type":kind,"id":int(entity_id),"name":name,"country":category.get("name") or (entity.get("country") or {}).get("name"),"slug":entity.get("slug"),"variant":team_variant(name) if kind=="team" else "Liga"})
        if len(items)>=limit: break
    return items

def team_upcoming(team_id: int, pages: int = 3) -> list[dict[str, Any]]:
    events={}
    for page in range(pages):
        payload=api_get(f"/team/{team_id}/events/next/{page}", allow_404=True)
        for event in payload.get("events",[]):
            if event.get("id") is not None: events[int(event["id"])]=event
    return list(events.values())

@router.get("/search")
def autocomplete(q: str=Query(min_length=2,max_length=80), limit:int=Query(default=10,ge=1,le=20)) -> dict[str,Any]:
    try:
        results=search_entities(q,limit)
        return {"query":q,"results":results,"degraded":False}
    except Exception as exc:
        return {"query":q,"results":[],"degraded":True,"warning":f"Fonte esportiva temporariamente indisponível: {exc}"}

@router.get("/upcoming")
def upcoming(date:str|None=Query(default=None),q:str|None=Query(default=None,max_length=80),team_id:int|None=Query(default=None,ge=1),limit:int=Query(default=15,ge=1,le=50)) -> dict[str,Any]:
    selected_date=date or datetime.now(TICKET_TZ).strftime("%Y-%m-%d"); events={}; source="global-schedule"; query=(q or "").strip(); warning=None
    try:
        if team_id:
            source="exact-team"; source_events=team_upcoming(team_id)
        elif query:
            entities=search_entities(query,10); team_ids=[i["id"] for i in entities if i["type"]=="team"][:5]
            if team_ids:
                source="team-search"; source_events=[]
                for tid in team_ids: source_events.extend(team_upcoming(tid))
            else:
                source="league-filter"; source_events=scheduled_events(selected_date)
        else: source_events=scheduled_events(selected_date)
        for event in source_events:
            if event.get("id") is not None: events[int(event["id"])]=event
    except Exception as exc:
        warning=f"Fonte esportiva temporariamente indisponível: {exc}"
    items=[event_to_item(e) for e in events.values()]
    if query and not team_id:
        needle=query.lower(); items=[i for i in items if any(needle in str(i.get(k) or "").lower() for k in ("home","away","league","country"))]
    items.sort(key=lambda i:i.get("startTimestamp") or 0); items=items[:limit]
    return {"date":selected_date,"query":query,"teamId":team_id,"count":len(items),"limit":limit,"scope":"all Sofascore football leagues","source":source,"events":items,"degraded":warning is not None,"warning":warning}
