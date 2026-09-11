"""
The closed-form Nash equilibria of Kuhn poker.

This module is the project's ground truth. Because Kuhn (1950) solved this game
analytically, we can check that CFR converges to a *known correct answer*
instead of merely checking that it converges to something.

The equilibrium set
-------------------
Player 0 (first to act) has a one-parameter family of equilibrium strategies,
indexed by alpha in [0, 1/3]:

    with a Jack : bet (bluff) with probability   alpha
    with a Queen: always check;
                  if raised, call with probability alpha + 1/3
    with a King : bet with probability           3 * alpha
                  if raised, always call
    with a Jack, if raised: always fold

Player 1's equilibrium strategy is *unique*:

    facing a check: bet with J w.p. 1/3, check with Q, bet with K
    facing a bet  : fold J, call Q w.p. 1/3, call K

Game value: -1/18 chips per hand to Player 0. The first player is structurally
disadvantaged in Kuhn poker by about 5.6% of an ante per hand.

Two facts here are the ones worth internalising, because they are the reason
poker is not solved by "bet good hands, fold bad ones":

  * The bluffing rate is forced. Player 0 must bluff the Jack sometimes. Betting
    only Kings makes a bet perfectly readable, and the opponent folds every
    Queen for free.
  * The calling rate is forced. Player 1 must call the Queen exactly 1/3 of the
    time. Calling less invites unlimited bluffing; calling more loses value to
    genuine Kings. 1/3 is precisely the rate that makes bluffing break even,
    which is what removes the opponent's incentive to deviate.

The K:J bluff ratio of 3:1 is not a coincidence either - it is the same
"balance" arithmetic that governs bet sizing in real poker.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Dict, List

from .kuhn import ACTIONS, CARDS, DEAL_PROB, DEALS, JACK, KING, QUEEN
from .kuhn import info_set_key, is_terminal, current_player, terminal_utility

# Exact game value to Player 0.
GAME_VALUE = -1.0 / 18.0
GAME_VALUE_EXACT = Fraction(-1, 18)

# alpha ranges over [0, 1/3]; alpha is Player 0's Jack-bluff frequency.
ALPHA_MIN, ALPHA_MAX = 0.0, 1.0 / 3.0


def nash_strategy(alpha: float = 1.0 / 6.0) -> Dict[str, List[float]]:
    """
    Build an exact equilibrium profile for a given alpha.

    Returns a mapping from information-set key to [P(pass), P(bet)]. The default
    alpha = 1/6 sits in the middle of the family.
    """
    if not (ALPHA_MIN - 1e-12 <= alpha <= ALPHA_MAX + 1e-12):
        raise ValueError("alpha must lie in [0, 1/3]; got %r" % (alpha,))
    alpha = min(max(alpha, ALPHA_MIN), ALPHA_MAX)

    def mix(bet_prob: float) -> List[float]:
        return [1.0 - bet_prob, bet_prob]

    return {
        # --- Player 0, opening decision -----------------------------------
        info_set_key(JACK, ""):    mix(alpha),        # the bluff
        info_set_key(QUEEN, ""):   mix(0.0),          # never bet the middle card
        info_set_key(KING, ""):    mix(3.0 * alpha),  # value bets, 3:1 vs bluffs
        # --- Player 0, checked then faced a bet ---------------------------
        info_set_key(JACK, "pb"):  mix(0.0),          # always fold
        info_set_key(QUEEN, "pb"): mix(alpha + 1.0 / 3.0),
        info_set_key(KING, "pb"):  mix(1.0),          # always call
        # --- Player 1, facing a check (unique) ----------------------------
        info_set_key(JACK, "p"):   mix(1.0 / 3.0),    # forced bluff rate
        info_set_key(QUEEN, "p"):  mix(0.0),
        info_set_key(KING, "p"):   mix(1.0),
        # --- Player 1, facing a bet (unique) ------------------------------
        info_set_key(JACK, "b"):   mix(0.0),          # always fold
        info_set_key(QUEEN, "b"):  mix(1.0 / 3.0),    # the forced call rate
        info_set_key(KING, "b"):   mix(1.0),
    }


def expected_value(strategy: Dict[str, List[float]]) -> float:
    """
    Exact expected value to Player 0 of a full strategy profile, computed by
    enumerating all 6 deals and every branch of the betting tree.

    No sampling, no variance: this is the true EV, not an estimate.
    """
    total = 0.0
    for deal in DEALS:
        total += DEAL_PROB * _walk(deal, "", strategy)
    return total


def _walk(deal, history: str, strategy: Dict[str, List[float]]) -> float:
    if is_terminal(history):
        return terminal_utility(history, deal)
    player = current_player(history)
    key = info_set_key(deal[player], history)
    probs = strategy[key]
    value = 0.0
    for i, action in enumerate(ACTIONS):
        if probs[i] > 0.0:
            value += probs[i] * _walk(deal, history + action, strategy)
    return value


def nearest_alpha(strategy: Dict[str, List[float]]) -> float:
    """
    Recover which member of the equilibrium family a solved strategy is closest
    to, by reading off Player 0's Jack-bluff frequency and clamping to [0, 1/3].

    Useful for the dashboard: CFR does not pick alpha for you, so reporting the
    recovered alpha explains *which* of the infinitely many equilibria it found.
    """
    alpha = strategy[info_set_key(JACK, "")][1]
    return min(max(alpha, ALPHA_MIN), ALPHA_MAX)


def deviation_from_family(strategy: Dict[str, List[float]]) -> Dict[str, float]:
    """
    Per-information-set absolute deviation between a solved strategy and the
    equilibrium in the family that best matches its alpha.

    Player 1's six entries are the meaningful test: that half of the profile is
    unique, so a correct solver must reproduce those numbers exactly. Player 0's
    entries are expected to differ across runs only through alpha.
    """
    reference = nash_strategy(nearest_alpha(strategy))
    return {
        key: abs(strategy[key][1] - reference[key][1]) for key in reference
    }


__all__ = [
    "GAME_VALUE", "GAME_VALUE_EXACT", "ALPHA_MIN", "ALPHA_MAX",
    "nash_strategy", "expected_value", "nearest_alpha", "deviation_from_family",
]
