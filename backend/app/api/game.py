"""Read-only endpoints describing the game itself and its known solution."""

from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, HTTPException, Query

from ..core import baselines, theory
from ..core.best_response import exploitability
from ..core.kuhn import (
    ACTIONS, CARD_CHARS, CARD_NAMES, DEALS,
    all_info_set_keys, describe_info_set, enumerate_histories, game_tree,
)

router = APIRouter(prefix="/api/game", tags=["game"])


@router.get("/rules")
def rules() -> dict:
    """Everything needed to render the rules and the betting tree."""
    return {
        "name": "Kuhn Poker",
        "players": 2,
        "deck": [{"char": c, "name": n, "rank": i}
                 for i, (c, n) in enumerate(zip(CARD_CHARS, CARD_NAMES))],
        "ante": 1,
        "bet_size": 1,
        "actions": [
            {"code": "p", "no_bet": "Check", "facing_bet": "Fold"},
            {"code": "b", "no_bet": "Bet", "facing_bet": "Call"},
        ],
        "deals": len(DEALS),
        "info_sets": len(all_info_set_keys()),
        "histories": enumerate_histories(),
        "tree": game_tree(),
        "steps": [
            "Both players ante 1 chip, so the pot starts at 2.",
            "Each player is dealt one of three cards: Jack, Queen or King. "
            "The third card is never shown.",
            "Player 1 acts first and may check or bet 1 chip.",
            "If Player 1 checks, Player 2 may check (ending the hand at "
            "showdown) or bet. Player 1 may then fold or call.",
            "If Player 1 bets, Player 2 may fold or call.",
            "At a showdown the higher card wins the pot. A fold gives the pot "
            "to the player who did not fold, whatever the cards were.",
        ],
    }


@router.get("/info-sets")
def info_sets() -> dict:
    """
    The 12 information sets: every distinct situation a player can face.

    An information set is what a player actually knows when acting - their own
    card plus the public betting so far, never the opponent's card. It is the
    unit CFR reasons about, and the reason the game cannot be solved by simply
    looking ahead.
    """
    return {"info_sets": [describe_info_set(k) for k in all_info_set_keys()]}


@router.get("/theory")
def analytical_solution(alpha: float = Query(1 / 6, ge=0.0, le=1 / 3)) -> dict:
    """The closed-form equilibrium, which the solver is checked against."""
    try:
        strategy = theory.nash_strategy(alpha)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "alpha": alpha,
        "alpha_range": [theory.ALPHA_MIN, theory.ALPHA_MAX],
        "strategy": strategy,
        "game_value": theory.GAME_VALUE,
        "expected_value": theory.expected_value(strategy),
        "exploitability": exploitability(strategy),
        "notes": [
            "Kuhn poker has a one-parameter family of equilibria, indexed by "
            "alpha in [0, 1/3]. Alpha is how often Player 1 bluffs the Jack.",
            "Player 2's equilibrium strategy is unique, so a correct solver "
            "must reproduce those six numbers exactly.",
            "Every member of the family is worth exactly -1/18 chips per hand "
            "to Player 1. Moving first is a structural disadvantage here.",
            "Player 1 must bet the King exactly 3x as often as the Jack. That "
            "3:1 value-to-bluff ratio is what makes the bets unreadable.",
            "Player 2 must call the Queen exactly 1/3 of the time - the rate "
            "that makes bluffing break even and removes any reason to bluff.",
        ],
    }


@router.get("/baselines")
def baseline_agents() -> dict:
    """The rule-based opponents, ranked by how exploitable each one is."""
    rows: List[Dict[str, object]] = []
    for name, strategy in baselines.all_baselines().items():
        rows.append({
            "name": name,
            "label": name.replace("_", " ").title(),
            "description": baselines.DESCRIPTIONS[name],
            "exploitability": exploitability(strategy),
            "strategy": strategy,
        })
    rows.sort(key=lambda r: -float(r["exploitability"]))
    return {"baselines": rows}
