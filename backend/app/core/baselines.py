"""
Rule-based opponents to measure the solved strategy against.

Exploitability tells you how a strategy fares against a *perfect* adversary.
That is the right worst-case number, but it says nothing about how the strategy
does against the flawed opponents it will actually meet. These baselines supply
that second axis.

Each baseline is an ordinary fixed strategy - the same dictionary shape CFR
produces - which means head-to-head results can be computed by exact
enumeration instead of simulation. Every "win rate" this project reports is a
closed-form number, not a noisy estimate.

The names are the classic poker archetypes because they fail in the classic
ways: the Calling Station cannot be bluffed but pays off every value bet, the
Maniac bluffs itself broke, the Rock folds away its equity, and the Honest
player - the one most beginners write first - loses precisely because it is
readable.
"""

from __future__ import annotations

from typing import Dict, List

from .kuhn import CARD_CHARS, JACK, KING, QUEEN, all_info_set_keys, info_set_key

Strategy = Dict[str, List[float]]


def _build(bet_probability) -> Strategy:
    """Build a strategy from a function of (card, history) -> P(bet/call)."""
    strategy: Strategy = {}
    for key in all_info_set_keys():
        card = CARD_CHARS.index(key[0])
        history = key[1:]
        p = float(bet_probability(card, history))
        strategy[key] = [1.0 - p, p]
    return strategy


# --- The archetypes --------------------------------------------------------

def calling_station() -> Strategy:
    """Never bets, never folds. Checks everything down and calls every bet."""
    return _build(lambda card, history: 1.0 if history.endswith("b") else 0.0)


def maniac() -> Strategy:
    """Bets and calls with everything. Maximum aggression, zero selectivity."""
    return _build(lambda card, history: 1.0)


def rock() -> Strategy:
    """Never bets, folds to every bet. Surrenders the pot on any resistance."""
    return _build(lambda card, history: 0.0)


def honest() -> Strategy:
    """
    Bets and calls only with the King; checks and folds everything else.

    This is the strategy almost everyone writes first, and it is the most
    instructive one to lose with. It never makes a "mistake" in the naive sense
    - it never bluffs off chips, never calls light - and yet it is one of the
    most exploitable strategies in the game, because every bet it makes is
    perfectly readable and every check invites a free steal.
    """
    return _build(lambda card, history: 1.0 if card == KING else 0.0)


def tight_aggressive() -> Strategy:
    """
    A competent heuristic: value-bet the King, call down with King and Queen,
    fold the Jack. Sensible, disciplined, and still missing the one thing that
    matters - it never bluffs, so it can never win a pot it did not deserve.
    """
    def rule(card: int, history: str) -> float:
        if history.endswith("b"):
            return 1.0 if card in (KING, QUEEN) else 0.0  # call K/Q, fold J
        return 1.0 if card == KING else 0.0               # value-bet the King

    return _build(rule)


def random_agent() -> Strategy:
    """Coin-flips every decision. The floor any real strategy must clear."""
    return _build(lambda card, history: 0.5)


def naive_bluffer() -> Strategy:
    """
    Bluffs the Jack far too often (75%) while playing the rest reasonably.

    Included because it fails in the opposite direction to `honest`, and
    because the equilibrium punishes it without ever changing its own plan.
    """
    def rule(card: int, history: str) -> float:
        if history.endswith("b"):
            return 1.0 if card == KING else (0.5 if card == QUEEN else 0.0)
        if card == KING:
            return 1.0
        if card == JACK:
            return 0.75
        return 0.0

    return _build(rule)


BASELINES = {
    "calling_station": calling_station,
    "maniac": maniac,
    "rock": rock,
    "honest": honest,
    "tight_aggressive": tight_aggressive,
    "naive_bluffer": naive_bluffer,
    "random": random_agent,
}

DESCRIPTIONS = {
    "calling_station": "Checks everything, calls every bet. Impossible to bluff, pays off every value bet.",
    "maniac": "Bets and calls with everything. Pure aggression with no selectivity.",
    "rock": "Never bets, folds to any bet. Gives up the pot at the first sign of resistance.",
    "honest": "Bets and calls only the King. The intuitive strategy - and a very exploitable one.",
    "tight_aggressive": "Value-bets the King, calls with King and Queen, folds the Jack. Sensible but never bluffs.",
    "naive_bluffer": "Bluffs the Jack 75% of the time. Aggressive in the wrong spots.",
    "random": "Coin-flips every decision.",
}


def get(name: str) -> Strategy:
    if name not in BASELINES:
        raise KeyError("unknown baseline %r; choose from %s"
                       % (name, ", ".join(sorted(BASELINES))))
    return BASELINES[name]()


def all_baselines() -> Dict[str, Strategy]:
    return {name: factory() for name, factory in BASELINES.items()}


__all__ = ["BASELINES", "DESCRIPTIONS", "get", "all_baselines", "Strategy"]
