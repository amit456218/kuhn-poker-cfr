"""Interactive play: deal hands against a chosen opponent and get coached."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..core import baselines
from ..solution import DEFAULT_SOLUTION
from ..store import TableStore

router = APIRouter(prefix="/api/play", tags=["play"])
TABLES = TableStore(DEFAULT_SOLUTION.strategy)


class NewTableRequest(BaseModel):
    opponent: str = Field("nash", description="'nash' or a baseline name")
    human_seat: int = Field(0, ge=0, le=1)
    seed: Optional[int] = None


class ActRequest(BaseModel):
    action: str = Field(..., description="'p' = check/fold, 'b' = bet/call")


def _require(table_id: str):
    table = TABLES.get(table_id)
    if table is None:
        raise HTTPException(status_code=404, detail="no such table")
    return table


@router.post("/tables")
def create_table(request: NewTableRequest) -> dict:
    known = set(baselines.BASELINES) | {"nash", "solver", "equilibrium"}
    if request.opponent not in known:
        raise HTTPException(
            status_code=400,
            detail="unknown opponent %r; choose 'nash' or one of: %s"
                   % (request.opponent, ", ".join(sorted(baselines.BASELINES))))
    table = TABLES.create(request.opponent, request.human_seat, request.seed)
    return TABLES.state(table)


@router.get("/tables/{table_id}")
def get_table(table_id: str) -> dict:
    return TABLES.state(_require(table_id))


@router.post("/tables/{table_id}/deal")
def deal(table_id: str) -> dict:
    return TABLES.state(TABLES.deal(_require(table_id)))


@router.post("/tables/{table_id}/act")
def act(table_id: str, request: ActRequest) -> dict:
    table = _require(table_id)
    try:
        TABLES.act(table, request.action)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return TABLES.state(table)
