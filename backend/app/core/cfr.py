"""
Counterfactual Regret Minimization.

The problem
-----------
Poker is an extensive-form game with imperfect information. Minimax and
alpha-beta do not apply: a player cannot evaluate a position, because the
position depends on a card they cannot see. Worse, the optimal strategy is
generally *randomised* - any deterministic strategy in Kuhn poker is heavily
exploitable, since a deterministic bet is a perfectly readable bet.

Kuhn poker is small enough to solve as a linear program, but that approach
scales with the number of game states and dies long before real poker. CFR is
the algorithm that scales, and it is the ancestor of the methods behind
Cepheus, Libratus and Pluribus.

The idea
--------
CFR is self-play driven by regret. It repeatedly walks the game tree and asks,
at every decision point, a purely local question:

    "How much better off would I have been had I always played action a here,
     instead of what my current strategy actually did?"

That quantity is *counterfactual regret*. Accumulate it over iterations, then
play each action in proportion to how much positive regret it has piled up
(regret matching). Actions that would have helped get played more; actions that
would have hurt fade out.

Why this works
--------------
Two results combine:

  1. Regret matching is a no-regret algorithm: average regret at each
     information set goes to 0 like O(1/sqrt(T)).
  2. In a two-player zero-sum game, if both players' average overall regret is
     below eps, their *average* strategies form a 2*eps-Nash equilibrium.

So minimising a local, greedy, per-decision quantity yields a global
equilibrium of the whole game. The formal bound is

    R_i^T / T  <=  Delta * |I_i| * sqrt(|A|) / sqrt(T)

with Delta the payoff range and |I_i| the number of information sets, giving
exploitability that decays as O(1/sqrt(T)).

The critical subtlety
---------------------
It is the **average strategy** over all iterations that converges to Nash, not
the current strategy. The current strategy never settles down - it oscillates
around the equilibrium forever. Reporting the current strategy is the single
most common way to get a plausible-looking but wrong solver, so this
implementation keeps them strictly separate.

Counterfactual weighting
------------------------
Each regret is weighted by pi_{-i}: the probability that chance and the
*opponent* would have brought us to this information set, deliberately
excluding the player's own contribution. Dividing out one's own reach
probability is what makes the regrets at different information sets
independently minimisable, which is what lets a local update rule solve a
global problem.

Variants implemented
--------------------
  vanilla : Zinkevich et al. (2007), the original.
  cfr+    : Tammelin (2014). Cumulative regrets are floored at zero after every
            update, iterations are weighted linearly in the average, and the
            two players are updated alternately. Typically 1-2 orders of
            magnitude faster in practice, and what solved Heads-Up Limit Hold'em.
  linear  : Brown & Sandholm (2019). Weights iteration t's regret contribution
            by t, so early, badly-informed iterations are discounted.
"""

from __future__ import annotations

import math
import time
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from .kuhn import (
    ACTIONS, DEAL_PROB, DEALS, NUM_ACTIONS,
    all_info_set_keys, current_player, info_set_key, is_terminal, terminal_utility,
)

Strategy = Dict[str, List[float]]

VARIANTS = ("vanilla", "cfr+", "linear")


class InfoSetNode:
    """
    Regret and strategy accumulators for one information set.

    Kuhn poker has exactly 12 of these. Real poker abstractions have billions,
    but the per-node bookkeeping is identical.
    """

    __slots__ = ("key", "regret_sum", "regret_delta", "strategy_sum", "strategy")

    def __init__(self, key: str) -> None:
        self.key = key
        self.regret_sum: List[float] = [0.0] * NUM_ACTIONS
        # Regret accrued during the current iteration, held separately so that
        # the whole iteration is applied as one atomic update (see below).
        self.regret_delta: List[float] = [0.0] * NUM_ACTIONS
        self.strategy_sum: List[float] = [0.0] * NUM_ACTIONS
        self.strategy: List[float] = [1.0 / NUM_ACTIONS] * NUM_ACTIONS

    def refresh_strategy(self) -> List[float]:
        """
        Regret matching: play proportionally to positive cumulative regret.

        Called once per iteration, before any tree walking. Freezing sigma^t for
        the duration of the iteration matters: CFR is defined over a *fixed*
        strategy profile per iteration, so recomputing it midway - between one
        deal and the next - would have each chance outcome evaluated against a
        slightly different opponent, which is not the algorithm.

        With no positive regret anywhere, which is the state at iteration 0,
        fall back to uniform.
        """
        positive = [r if r > 0.0 else 0.0 for r in self.regret_sum]
        total = positive[0] + positive[1]
        if total > 0.0:
            self.strategy = [p / total for p in positive]
        else:
            self.strategy = [1.0 / NUM_ACTIONS] * NUM_ACTIONS
        return self.strategy

    def apply_regrets(self, regret_matching_plus: bool) -> None:
        """
        Commit this iteration's accumulated regret.

        The zero-floor of regret matching+ belongs *here*, applied once to the
        iteration's full counterfactual regret summed over every chance
        outcome. Clipping after each individual deal instead would let one deal
        zero out the accumulator before a later deal's contribution is added,
        destroying information and dragging CFR+ back down to the vanilla
        convergence rate.
        """
        for i in range(NUM_ACTIONS):
            total = self.regret_sum[i] + self.regret_delta[i]
            self.regret_sum[i] = max(0.0, total) if regret_matching_plus else total
            self.regret_delta[i] = 0.0

    def average_strategy(self) -> List[float]:
        """
        The time-averaged strategy - this is the one that converges to Nash.

        Before any weight has accumulated (an information set that is never
        reached), uniform is the correct neutral answer.
        """
        total = self.strategy_sum[0] + self.strategy_sum[1]
        if total > 0.0:
            return [s / total for s in self.strategy_sum]
        return [1.0 / NUM_ACTIONS] * NUM_ACTIONS


class CFRSolver:
    """
    A CFR solver for Kuhn poker with exact chance enumeration.

    Rather than dealing random cards, every iteration walks all six possible
    deals weighted by their probability. That removes sampling variance
    entirely, so the convergence curve is smooth and reproducible - the right
    choice for a game this size. Monte-Carlo sampling (MCCFR) is what you reach
    for when the tree is too large to enumerate.
    """

    def __init__(self, variant: str = "cfr+") -> None:
        if variant not in VARIANTS:
            raise ValueError("variant must be one of %r; got %r" % (VARIANTS, variant))
        self.variant = variant
        self.nodes: Dict[str, InfoSetNode] = {
            key: InfoSetNode(key) for key in all_info_set_keys()
        }
        self.iterations = 0
        # Alternating updates walk the tree once per player per iteration, so
        # each player answers the other's freshly improved strategy rather than
        # a stale snapshot. Measured on this game (see tests/test_convergence.py)
        # this single choice matters more than regret matching+ does: it is
        # worth ~2 orders of magnitude of exploitability on its own.
        self.alternating = variant in ("cfr+", "linear")
        self.regret_matching_plus = variant == "cfr+"

    # -- the core recursion -------------------------------------------------

    def _walk(self, deal: Tuple[int, int], history: str,
              reach0: float, reach1: float, chance: float,
              updating_player: Optional[int],
              regret_weight: float, average_weight: float) -> float:
        """
        Recursively walk the tree, returning the expected value to Player 0.

        `reach0` / `reach1` are how likely each player's own strategy is to
        produce this history; `chance` is the deal probability. Keeping the
        three separate is exactly what makes the counterfactual weighting below
        possible.
        """
        if is_terminal(history):
            return terminal_utility(history, deal)

        player = current_player(history)
        node = self.nodes[info_set_key(deal[player], history)]
        strategy = node.strategy  # frozen for this iteration
        updating = updating_player is None or player == updating_player

        # Accumulate the average strategy, weighted by this player's OWN reach.
        # A strategy is evidence about how to play an information set only in
        # proportion to how often this player actually arrives there.
        if updating:
            own_reach = reach0 if player == 0 else reach1
            contribution = own_reach * chance * average_weight
            if contribution > 0.0:
                node.strategy_sum[0] += contribution * strategy[0]
                node.strategy_sum[1] += contribution * strategy[1]

        # Value of each action, and of the node under the current strategy.
        action_values = [0.0, 0.0]
        for i, action in enumerate(ACTIONS):
            if player == 0:
                action_values[i] = self._walk(deal, history + action,
                                              reach0 * strategy[i], reach1,
                                              chance, updating_player,
                                              regret_weight, average_weight)
            else:
                action_values[i] = self._walk(deal, history + action,
                                              reach0, reach1 * strategy[i],
                                              chance, updating_player,
                                              regret_weight, average_weight)
        node_value = strategy[0] * action_values[0] + strategy[1] * action_values[1]

        # Counterfactual regret, buffered until the end of the iteration.
        if updating:
            # Payoffs come back from Player 0's perspective; flip for Player 1.
            sign = 1.0 if player == 0 else -1.0
            # The counterfactual weight: chance and the OPPONENT's reach, with
            # this player's own reach deliberately excluded. Dividing out one's
            # own probability of arriving here is what decouples the
            # information sets and lets a local rule solve the global game.
            counterfactual = (reach1 if player == 0 else reach0) * chance
            if counterfactual > 0.0:
                for i in range(NUM_ACTIONS):
                    regret = sign * (action_values[i] - node_value)
                    node.regret_delta[i] += counterfactual * regret * regret_weight

        return node_value

    # -- driving the iterations --------------------------------------------

    def _weights(self, t: int) -> Tuple[float, float]:
        """
        (regret_weight, average_weight) for iteration t.

        These are genuinely different knobs, and conflating them silently turns
        CFR+ into something no faster than vanilla CFR.

          vanilla : every iteration counts equally, everywhere.
          cfr+    : regrets are UNWEIGHTED - the max(0, .) floor is what does
                    the work - while the strategy average is linearly weighted,
                    so later, better-informed iterations dominate the answer.
          linear  : both are weighted by t, discounting the early iterations
                    made before the strategy knew anything.
        """
        if self.variant == "cfr+":
            return 1.0, float(t)
        if self.variant == "linear":
            return float(t), float(t)
        return 1.0, 1.0

    def _traverse(self, updating_player: Optional[int],
                  regret_weight: float, average_weight: float) -> None:
        """One full pass over all six deals, then one atomic regret update."""
        for node in self.nodes.values():
            node.refresh_strategy()
        for deal in DEALS:
            self._walk(deal, "", 1.0, 1.0, DEAL_PROB,
                       updating_player, regret_weight, average_weight)
        for node in self.nodes.values():
            node.apply_regrets(self.regret_matching_plus)

    def step(self) -> None:
        """Run a single CFR iteration."""
        self.iterations += 1
        regret_weight, average_weight = self._weights(self.iterations)

        if self.alternating:
            # Alternating updates: player 0 improves against player 1's current
            # strategy, then player 1 immediately answers the improved player 0.
            for player in (0, 1):
                self._traverse(player, regret_weight, average_weight)
        else:
            # Simultaneous updates: both players learn from the same snapshot.
            self._traverse(None, regret_weight, average_weight)

    def train(self, iterations: int,
              snapshot_at: Optional[Sequence[int]] = None,
              on_snapshot: Optional[Callable[[dict], None]] = None,
              should_stop: Optional[Callable[[], bool]] = None) -> List[dict]:
        """
        Train for `iterations` iterations, recording convergence metrics at each
        iteration listed in `snapshot_at`.

        Snapshots are what the dashboard plots. Measuring exploitability costs
        far more than an iteration does, so we sample it on a log-spaced grid
        rather than every step. Pass `snapshot_at=[]` to record none.
        """
        targets = set(log_spaced(iterations) if snapshot_at is None else snapshot_at)
        snapshots: List[dict] = []
        started = time.perf_counter()

        for _ in range(iterations):
            if should_stop is not None and should_stop():
                break
            self.step()
            if self.iterations in targets:
                snapshot = self._snapshot(time.perf_counter() - started)
                snapshots.append(snapshot)
                if on_snapshot is not None:
                    on_snapshot(snapshot)

        return snapshots

    def _snapshot(self, elapsed: float) -> dict:
        from .best_response import exploitability_report
        from .theory import GAME_VALUE, expected_value, nearest_alpha

        average = self.average_strategy()
        report = exploitability_report(average)
        return {
            "iteration": self.iterations,
            "elapsed_seconds": elapsed,
            "exploitability": report["exploitability"],
            "percent_of_ante": report["percent_of_ante"],
            "milli_antes_per_hand": report["milli_antes_per_hand"],
            "best_response_value_p0": report["best_response_value_p0"],
            "best_response_value_p1": report["best_response_value_p1"],
            "expected_value": expected_value(average),
            "game_value": GAME_VALUE,
            "alpha": nearest_alpha(average),
        }

    # -- reading out the answer --------------------------------------------

    def average_strategy(self) -> Strategy:
        """The solved strategy: the time-average, which is what converges."""
        return {key: node.average_strategy() for key, node in self.nodes.items()}

    def current_strategy(self) -> Strategy:
        """
        The latest regret-matched strategy. Exposed for the dashboard because
        watching it oscillate while the average converges is the clearest
        demonstration of why the average is the one that matters.
        """
        return {key: list(node.strategy) for key, node in self.nodes.items()}

    def regrets(self) -> Dict[str, List[float]]:
        return {key: list(node.regret_sum) for key, node in self.nodes.items()}


def log_spaced(iterations: int, points: int = 60) -> List[int]:
    """
    Roughly log-spaced snapshot iterations in [1, iterations].

    Convergence is a power law, so it is a straight line on log-log axes only
    if the samples are log-spaced. Linear spacing wastes almost every sample on
    the flat tail.
    """
    if iterations <= points:
        return list(range(1, iterations + 1))
    values = {1, iterations}
    log_max = math.log10(iterations)
    for i in range(points):
        values.add(int(round(10 ** (log_max * i / (points - 1)))))
    return sorted(v for v in values if 1 <= v <= iterations)


def solve(iterations: int = 100_000, variant: str = "cfr+") -> Tuple[CFRSolver, List[dict]]:
    """Convenience wrapper: build a solver, train it, hand back both."""
    solver = CFRSolver(variant=variant)
    snapshots = solver.train(iterations)
    return solver, snapshots


__all__ = ["CFRSolver", "InfoSetNode", "Strategy", "VARIANTS", "log_spaced", "solve"]
