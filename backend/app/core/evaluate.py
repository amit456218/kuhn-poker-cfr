"""
Head-to-head evaluation: exact expected value, Monte-Carlo simulation, and the
statistics needed to say whether a measured edge is real.

Three ideas drive the design.

Seat matters, so both seats get played
--------------------------------------
Kuhn poker is not symmetric: the first player is worth -1/18 chips per hand at
equilibrium. Comparing a strategy in seat 0 against a baseline in seat 1 would
therefore measure the seat as much as the strategy. Every result here is
*duplicate-scored*: each pairing is played from both seats and the two figures
averaged, which cancels the positional term exactly.

Exact beats sampled, when exact is available
--------------------------------------------
Both a CFR solution and a rule-based baseline are fixed strategies, so their
head-to-head expected value can be computed by enumerating all six deals and
every branch of the tree. That is a closed-form number with no confidence
interval attached. The Monte-Carlo path exists to *validate* the exact
computation and to produce realistic hand-by-hand distributions, not because
the estimate is needed.

An estimate without an interval is not a result
-----------------------------------------------
Simulated win rates come back with a standard error, a 95% confidence interval
and a p-value against the null hypothesis of a zero edge. Poker results have
enormous variance relative to their means: in this game a single hand swings
+-2 chips while a strong edge is ~0.2 chips per hand, so a few hundred hands
can easily show the wrong sign. The interval is what separates a measured edge
from a lucky one.
"""

from __future__ import annotations

import math
import random
from typing import Dict, List, Optional, Sequence, Tuple

from .best_response import best_response, best_response_strategy, exploitability
from .kuhn import (
    ACTIONS, DEAL_PROB, DEALS,
    current_player, info_set_key, is_terminal, terminal_utility,
)

Strategy = Dict[str, List[float]]
# Either one strategy used in both seats, or a (player0, player1) pair. The
# exploitative agent needs the pair form, because the best response to an
# opponent depends on which seat you are sitting in.
SeatedStrategy = object


def _seat(strategy, seat: int) -> Strategy:
    """Resolve a strategy-or-pair down to the strategy for one seat."""
    if isinstance(strategy, tuple):
        return strategy[seat]
    return strategy


def exploitative_agent(opponent: Strategy) -> Tuple[Strategy, Strategy]:
    """
    The maximally exploitative counter-strategy to `opponent`, one per seat.

    Contrast with the equilibrium: this agent wins the most possible against
    this specific opponent, and would be crushed by an opponent who noticed.
    """
    return best_response_strategy(opponent, 0), best_response_strategy(opponent, 1)


# --------------------------------------------------------------------------
# Exact evaluation
# --------------------------------------------------------------------------

def exact_ev(p0_strategy: Strategy, p1_strategy: Strategy) -> float:
    """
    Exact expected value to Player 0 when the two seats use different
    strategies. Enumerates every deal and every branch; no sampling.
    """
    def walk(deal, history: str) -> float:
        if is_terminal(history):
            return terminal_utility(history, deal)
        player = current_player(history)
        source = p0_strategy if player == 0 else p1_strategy
        probs = source[info_set_key(deal[player], history)]
        total = 0.0
        for i, action in enumerate(ACTIONS):
            if probs[i] > 0.0:
                total += probs[i] * walk(deal, history + action)
        return total

    return sum(DEAL_PROB * walk(deal, "") for deal in DEALS)


def duplicate_ev(strategy, opponent: Strategy) -> Dict[str, float]:
    """
    Seat-balanced expected value to `strategy`, in chips per hand.

    Playing both seats removes the structural -1/18 first-player disadvantage,
    so the number that comes back reflects strategy quality alone.
    """
    as_p0 = exact_ev(_seat(strategy, 0), opponent)        # value to us, seated first
    as_p1 = -exact_ev(opponent, _seat(strategy, 1))       # value to us, seated second
    return {
        "ev_as_player0": as_p0,
        "ev_as_player1": as_p1,
        "ev_per_hand": (as_p0 + as_p1) / 2.0,
        "milli_antes_per_hand": (as_p0 + as_p1) / 2.0 * 1000.0,
    }


def exploitative_gap(strategy, opponent: Strategy) -> Dict[str, float]:
    """
    How much expected value equilibrium play leaves on the table against a
    specific flawed opponent.

    This is the most misunderstood property of a Nash strategy, and worth
    stating plainly: an equilibrium does not try to win the maximum. It
    guarantees it cannot *lose* more than the game value, whoever it faces. A
    best response to this particular opponent earns strictly more, but is
    itself wide open to a counter-adjustment. The gap below is the price of
    that safety.
    """
    nash_side = duplicate_ev(strategy, opponent)["ev_per_hand"]
    br_as_p0, _ = best_response(opponent, 0)
    br_as_p1, _ = best_response(opponent, 1)
    max_exploit = (br_as_p0 + br_as_p1) / 2.0
    return {
        "equilibrium_ev": nash_side,
        "max_exploit_ev": max_exploit,
        "gap": max_exploit - nash_side,
    }


# --------------------------------------------------------------------------
# Monte-Carlo simulation
# --------------------------------------------------------------------------

def _play_hand(deal: Tuple[int, int], p0_strategy: Strategy,
               p1_strategy: Strategy, rng: random.Random) -> Tuple[float, str]:
    """Play one hand, sampling each decision from the acting player's strategy."""
    history = ""
    while not is_terminal(history):
        player = current_player(history)
        source = p0_strategy if player == 0 else p1_strategy
        probs = source[info_set_key(deal[player], history)]
        history += ACTIONS[0] if rng.random() < probs[0] else ACTIONS[1]
    return terminal_utility(history, deal), history


def simulate(strategy, opponent: Strategy, hands: int = 100_000,
             seed: Optional[int] = 42) -> Dict[str, object]:
    """
    Play `hands` hands, alternating seats, and report the result with its
    uncertainty.

    Seats alternate every hand so the sample is seat-balanced by construction,
    matching the exact duplicate figure it is checked against.
    """
    if hands <= 0:
        raise ValueError("hands must be positive")

    rng = random.Random(seed)
    total = 0.0
    total_sq = 0.0
    wins = losses = 0
    showdowns = folds = 0
    by_seat = {0: [0.0, 0], 1: [0.0, 0]}

    for i in range(hands):
        we_are_p0 = (i % 2 == 0)
        deal = DEALS[rng.randrange(len(DEALS))]
        if we_are_p0:
            payoff, history = _play_hand(deal, _seat(strategy, 0), opponent, rng)
        else:
            payoff, history = _play_hand(deal, opponent, _seat(strategy, 1), rng)
            payoff = -payoff  # flip to our perspective

        total += payoff
        total_sq += payoff * payoff
        if payoff > 0:
            wins += 1
        elif payoff < 0:
            losses += 1
        if history in ("pp", "bb", "pbb"):
            showdowns += 1
        else:
            folds += 1
        seat = 0 if we_are_p0 else 1
        by_seat[seat][0] += payoff
        by_seat[seat][1] += 1

    mean = total / hands
    # Population variance of the per-hand payoff, then the standard error.
    variance = max(0.0, total_sq / hands - mean * mean)
    stdev = math.sqrt(variance)
    sem = stdev / math.sqrt(hands) if hands > 1 else float("inf")

    # Null hypothesis: the true per-hand edge is zero. With n in the tens of
    # thousands the t-distribution is indistinguishable from the normal, so a
    # z-test is used and reported as such.
    z = mean / sem if sem > 0 else 0.0
    p_value = 2.0 * (1.0 - _normal_cdf(abs(z)))
    half_width = 1.959963985 * sem  # 95%

    exact = duplicate_ev(strategy, opponent)["ev_per_hand"]

    return {
        "hands": hands,
        "seed": seed,
        "ev_per_hand": mean,
        "stdev": stdev,
        "standard_error": sem,
        "ci95_low": mean - half_width,
        "ci95_high": mean + half_width,
        "z_score": z,
        "p_value": p_value,
        "significant_at_95": p_value < 0.05,
        "win_rate": wins / hands,
        "loss_rate": losses / hands,
        "wins": wins,
        "losses": losses,
        "showdown_rate": showdowns / hands,
        "fold_rate": folds / hands,
        "ev_as_player0": by_seat[0][0] / by_seat[0][1] if by_seat[0][1] else 0.0,
        "ev_as_player1": by_seat[1][0] / by_seat[1][1] if by_seat[1][1] else 0.0,
        "exact_ev_per_hand": exact,
        # The validation that matters: does the sampled mean land inside its own
        # interval around the analytically known answer?
        "exact_within_ci95": (mean - half_width) <= exact <= (mean + half_width),
        "absolute_error_vs_exact": abs(mean - exact),
        "standard_errors_from_exact": abs(mean - exact) / sem if sem > 0 else 0.0,
    }


def _normal_cdf(x: float) -> float:
    """Standard normal CDF via the error function."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def required_hands(edge: float, stdev: float = 1.0, z: float = 1.959963985) -> int:
    """
    Hands needed to resolve an edge of `edge` chips/hand at 95% confidence.

    Included because it is the number that surprises people: the sample size
    scales with the *square* of the inverse edge, so halving the edge you want
    to detect quadruples the hands you need.
    """
    if edge <= 0:
        raise ValueError("edge must be positive")
    return int(math.ceil((z * stdev / edge) ** 2))


# --------------------------------------------------------------------------
# Tournament
# --------------------------------------------------------------------------

def evaluate_against_baselines(strategy,
                               baselines: Dict[str, Strategy],
                               hands: int = 100_000,
                               seed: Optional[int] = 42,
                               simulate_too: bool = True) -> List[Dict[str, object]]:
    """Play the solved strategy against every baseline and collect the results."""
    rows: List[Dict[str, object]] = []
    for name, opponent in sorted(baselines.items()):
        row: Dict[str, object] = {"opponent": name}
        row.update(duplicate_ev(strategy, opponent))
        row.update(exploitative_gap(strategy, opponent))
        row["opponent_exploitability"] = exploitability(opponent)
        if simulate_too:
            row["simulation"] = simulate(strategy, opponent, hands=hands, seed=seed)
        rows.append(row)
    rows.sort(key=lambda r: -float(r["ev_per_hand"]))
    return rows


__all__ = [
    "exact_ev", "duplicate_ev", "exploitative_gap", "simulate",
    "required_hands", "evaluate_against_baselines", "exploitative_agent",
]
