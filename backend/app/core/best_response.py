"""
Exact best response and exploitability.

Exploitability is the only honest scoreboard for a poker solver. "The strategy
stopped changing" proves nothing; a solver can converge confidently to a
non-equilibrium. Exploitability asks the real question:

    if a perfectly informed adversary knew our strategy and played the single
    best counter-strategy to it, how much would we lose?

For a two-player zero-sum game with value v to Player 0:

    eps = ( BR_0(sigma_1) + BR_1(sigma_0) ) / 2

where BR_i(.) is the value player i achieves with a best response. At a Nash
equilibrium BR_0 = v and BR_1 = -v, so the sum cancels and eps = 0. Elsewhere
the sum is strictly positive. A strategy with exploitability eps is an
eps-Nash equilibrium: nobody can gain more than eps per hand by deviating.

Computing the best response correctly
-------------------------------------
The subtle part is that the maximisation must happen at the *information set*,
not at individual game states. A best responder still cannot see the opponent's
card, so it must commit to one action across every deal consistent with what it
observes. Taking a max at each history separately would silently grant the
best responder clairvoyance and report an exploitability that is too high.

So each candidate action is scored by its *counterfactual value*: the payoff
summed over all deals in the information set, each weighted by the probability
that chance and the opponent would have produced that state. The best
responder's own probability of reaching the set is deliberately excluded, which
is what makes the choice at each set independent of its choices elsewhere.

Information sets are resolved deepest-first so that when a shallow decision is
scored, the optimal continuation below it is already known.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

from .kuhn import (
    ACTIONS, CARDS, DEAL_PROB, DEALS, all_info_set_keys,
    current_player, info_set_key, is_terminal, terminal_utility,
)

Strategy = Dict[str, List[float]]

# The histories at which each player acts, ordered deepest-first so that a
# decision is only scored once everything beneath it has been settled.
_DECISION_HISTORIES: Dict[int, Tuple[str, ...]] = {
    0: ("pb", ""),
    1: ("p", "b"),
}


def _opponent_reach(history: str, deal, strategy: Strategy, br_player: int) -> float:
    """
    Probability that the opponent's own choices lead to `history`.

    The best responder's actions along the way are skipped on purpose - this is
    the "counterfactual" in counterfactual value. Chance is handled separately
    by the uniform deal weight.
    """
    reach = 1.0
    for depth, action in enumerate(history):
        actor = depth % 2
        if actor == br_player:
            continue
        key = info_set_key(deal[actor], history[:depth])
        reach *= strategy[key][ACTIONS.index(action)]
    return reach


def _value(history: str, deal, strategy: Strategy, br_player: int,
           br_actions: Dict[str, int]) -> float:
    """
    Value to `br_player` from `history` onward, with the opponent following
    `strategy` and the best responder following the already-decided `br_actions`.
    """
    if is_terminal(history):
        utility = terminal_utility(history, deal)
        return utility if br_player == 0 else -utility

    actor = current_player(history)
    key = info_set_key(deal[actor], history)

    if actor == br_player:
        action = ACTIONS[br_actions[key]]
        return _value(history + action, deal, strategy, br_player, br_actions)

    probs = strategy[key]
    total = 0.0
    for i, action in enumerate(ACTIONS):
        if probs[i] > 0.0:
            total += probs[i] * _value(history + action, deal, strategy,
                                       br_player, br_actions)
    return total


def _solve(strategy: Strategy, br_player: int):
    """
    Shared machinery for the best response and its per-action value table.

    Returns (value, chosen action per information set, counterfactual table).
    """
    br_actions: Dict[str, int] = {}
    table: Dict[str, Dict[str, object]] = {}

    for history in _DECISION_HISTORIES[br_player]:
        for card in CARDS:
            key = info_set_key(card, history)
            counterfactual = [0.0, 0.0]
            reach = 0.0

            for deal in DEALS:
                if deal[br_player] != card:
                    continue  # this deal is not in the information set
                weight = DEAL_PROB * _opponent_reach(history, deal, strategy, br_player)
                if weight == 0.0:
                    continue
                reach += weight
                for i, action in enumerate(ACTIONS):
                    counterfactual[i] += weight * _value(
                        history + action, deal, strategy, br_player, br_actions
                    )

            # Ties resolve to pass; any tie-break is equally optimal by definition.
            br_actions[key] = 0 if counterfactual[0] >= counterfactual[1] else 1
            # Normalising by the reach turns "counterfactual value" into the
            # plain-English quantity a player wants: the average chips this
            # action is worth *given* you are actually in this spot.
            normalized = [c / reach for c in counterfactual] if reach > 0 else [0.0, 0.0]
            table[key] = {
                "counterfactual": counterfactual,
                "reach": reach,
                "values": normalized,
                "best": br_actions[key],
                "loss": [max(normalized) - v for v in normalized],
            }

    value = sum(
        DEAL_PROB * _value("", deal, strategy, br_player, br_actions)
        for deal in DEALS
    )
    return value, br_actions, table


def best_response(strategy: Strategy, br_player: int) -> Tuple[float, Dict[str, int]]:
    """
    Compute the best response to `strategy` for `br_player`.

    Returns (value to br_player, chosen action index per information set).
    """
    value, actions, _ = _solve(strategy, br_player)
    return value, actions


def action_values(strategy: Strategy, br_player: int) -> Dict[str, Dict[str, object]]:
    """
    Per-information-set, per-action expected values against `strategy`.

    This is what turns the solver into a coach. At any spot the player faces,
    it answers "what is checking worth here, what is betting worth, and how
    much did the move I actually made cost me?" - all measured against this
    specific opponent, in chips per hand, conditional on reaching the spot.
    """
    _, _, table = _solve(strategy, br_player)
    return table


def exploitability(strategy: Strategy) -> float:
    """
    Exploitability in chips per hand: the average amount a best-responding
    adversary gains against this profile. Zero exactly at a Nash equilibrium.
    """
    v0, _ = best_response(strategy, 0)
    v1, _ = best_response(strategy, 1)
    return (v0 + v1) / 2.0


def exploitability_report(strategy: Strategy) -> Dict[str, float]:
    """
    Exploitability with the per-player breakdown and the normalisations used on
    the dashboard.

    `milli_antes` is chips/hand x 1000, the Kuhn analogue of the mbb/hand unit
    standard in poker-AI papers. `percent_of_ante` expresses the same number as
    a percentage of the 1-chip ante, which is the figure quoted as
    "sub-1% exploitability".
    """
    v0, _ = best_response(strategy, 0)
    v1, _ = best_response(strategy, 1)
    eps = (v0 + v1) / 2.0
    return {
        "exploitability": eps,
        "best_response_value_p0": v0,
        "best_response_value_p1": v1,
        "milli_antes_per_hand": eps * 1000.0,
        "percent_of_ante": eps * 100.0,
    }


def best_response_strategy(opponent: Strategy, br_player: int) -> Strategy:
    """
    The best response rendered as a playable strategy, for use as an
    *exploitative* agent.

    A best response is always deterministic - it knows exactly which opponent
    it faces, so there is nothing to hide and no reason to randomise. That is
    also its weakness: it maximises expected value against this one opponent
    and is wide open to anyone who adapts to it. Equilibrium play is the
    opposite trade. The dashboard runs both so the trade-off is visible rather
    than asserted.

    Information sets belonging to the other seat are filled with a uniform
    placeholder; they are never consulted, because the opponent's own strategy
    supplies those decisions.
    """
    _, actions = best_response(opponent, br_player)
    strategy: Strategy = {key: [0.5, 0.5] for key in all_info_set_keys()}
    for key, index in actions.items():
        strategy[key] = [1.0, 0.0] if index == 0 else [0.0, 1.0]
    return strategy


__all__ = [
    "best_response", "best_response_strategy", "action_values",
    "exploitability", "exploitability_report", "Strategy",
]
