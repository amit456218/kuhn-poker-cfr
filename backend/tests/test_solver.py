"""
Correctness tests for the Kuhn poker CFR solver.

The point of choosing Kuhn poker is that these are not smoke tests: the game
has a known closed-form solution, so every claim the dashboard makes can be
checked against ground truth rather than against a previous run's output.
"""

import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import theory
from app.core.best_response import best_response, exploitability, exploitability_report
from app.core.cfr import CFRSolver, log_spaced
from app.core.kuhn import (
    ACTIONS, CARDS, DEALS, JACK, KING, QUEEN,
    all_info_set_keys, info_set_key, is_terminal, terminal_utility,
)


# --------------------------------------------------------------------------
# Game definition
# --------------------------------------------------------------------------

def test_game_shape():
    assert len(DEALS) == 6                      # 3 cards, 2 players, ordered
    assert len(all_info_set_keys()) == 12       # 6 per player
    assert len(set(all_info_set_keys())) == 12  # and all distinct


@pytest.mark.parametrize("history,expected", [
    ("pp", 1.0),    # checked down, K beats J, small pot
    ("bp", 1.0),    # P1 folded to a bet
    ("bb", 2.0),    # bet and called, big pot
    ("pbp", -1.0),  # P0 folded to a bet
    ("pbb", 2.0),   # bet and called, big pot
])
def test_terminal_payoffs_king_vs_jack(history, expected):
    assert terminal_utility(history, (KING, JACK)) == expected


def test_folding_ignores_cards():
    """A fold is decided by who folded, never by who held the better card."""
    for deal in DEALS:
        assert terminal_utility("bp", deal) == 1.0    # P1 always loses 1
        assert terminal_utility("pbp", deal) == -1.0  # P0 always loses 1


def test_showdowns_are_zero_sum_across_deals():
    """Summed over all deals, a symmetric showdown pays nobody."""
    assert sum(terminal_utility("pp", d) for d in DEALS) == 0.0
    assert sum(terminal_utility("bb", d) for d in DEALS) == 0.0


# --------------------------------------------------------------------------
# Analytical equilibrium
# --------------------------------------------------------------------------

@pytest.mark.parametrize("alpha", [0.0, 1 / 12, 1 / 6, 1 / 4, 1 / 3])
def test_every_equilibrium_has_the_same_value(alpha):
    """
    The whole alpha-family is an equilibrium set, so all of them must pay
    Player 0 exactly -1/18. This one assertion cross-checks the payoff table,
    the tree walk and the analytical strategies at once.
    """
    ev = theory.expected_value(theory.nash_strategy(alpha))
    assert ev == pytest.approx(-1 / 18, abs=1e-12)


@pytest.mark.parametrize("alpha", [0.0, 1 / 12, 1 / 6, 1 / 4, 1 / 3])
def test_analytical_equilibria_are_unexploitable(alpha):
    """
    The sharpest available test of the best-response code. If it ever let the
    best responder peek at the opponent's private card, a true equilibrium
    would measure as exploitable.
    """
    assert exploitability(theory.nash_strategy(alpha)) == pytest.approx(0.0, abs=1e-12)


def test_alpha_outside_the_family_is_rejected():
    with pytest.raises(ValueError):
        theory.nash_strategy(0.5)


# --------------------------------------------------------------------------
# Best response
# --------------------------------------------------------------------------

def test_naive_strategies_are_exploitable():
    """
    Sanity anchors, and the pedagogical heart of the project: playing your
    cards "honestly" is far worse than playing them randomly-but-balanced.
    """
    uniform = {k: [0.5, 0.5] for k in all_info_set_keys()}
    never_bluff = {k: ([1.0, 0.0] if k[0] in "JQ" else [0.0, 1.0])
                   for k in all_info_set_keys()}
    assert exploitability(uniform) == pytest.approx(0.4583333, abs=1e-6)
    assert exploitability(never_bluff) == pytest.approx(0.25, abs=1e-9)


def test_best_response_beats_or_matches_the_game_value():
    """A best response can never do worse than the equilibrium guarantees."""
    nash = theory.nash_strategy(1 / 6)
    v0, _ = best_response(nash, 0)
    v1, _ = best_response(nash, 1)
    assert v0 >= theory.GAME_VALUE - 1e-12
    assert v1 >= -theory.GAME_VALUE - 1e-12


def test_best_response_punishes_a_folder():
    """
    Against an opponent who always passes - checking behind, and folding to
    every bet - a best responder wins the maximum 1 chip on every single hand.

    Note the King is a genuine indifference: betting wins 1 because the
    opponent folds, and checking also wins 1 because the King wins the
    showdown. So only the Jack and Queen have a strictly optimal action, and
    asserting a particular choice for the King would only be testing the
    tie-break rule.
    """
    always_pass = {k: [1.0, 0.0] for k in all_info_set_keys()}
    v0, actions = best_response(always_pass, 0)

    assert v0 == pytest.approx(1.0, abs=1e-12)   # the theoretical maximum
    bet = ACTIONS.index("b")
    assert actions[info_set_key(JACK, "")] == bet   # checking would lose the showdown
    assert actions[info_set_key(QUEEN, "")] == bet  # checking is only worth 0


# --------------------------------------------------------------------------
# CFR convergence
# --------------------------------------------------------------------------

@pytest.mark.parametrize("variant", ["vanilla", "cfr+", "linear"])
def test_cfr_converges_to_equilibrium(variant):
    solver = CFRSolver(variant)
    solver.train(3000, snapshot_at=[])
    average = solver.average_strategy()
    assert exploitability(average) < 5e-3
    assert theory.expected_value(average) == pytest.approx(theory.GAME_VALUE, abs=5e-3)


def test_cfr_recovers_player_ones_unique_strategy():
    """
    Player 1's equilibrium strategy is unique, so a correct solver has no
    freedom here and must reproduce these exact frequencies. Player 0's side is
    a continuum, which is why it is checked through alpha instead.
    """
    solver = CFRSolver("cfr+")
    solver.train(20000, snapshot_at=[])
    s = solver.average_strategy()

    assert s[info_set_key(JACK, "p")][1] == pytest.approx(1 / 3, abs=5e-3)   # bluff rate
    assert s[info_set_key(QUEEN, "p")][1] == pytest.approx(0.0, abs=5e-3)
    assert s[info_set_key(KING, "p")][1] == pytest.approx(1.0, abs=5e-3)
    assert s[info_set_key(JACK, "b")][1] == pytest.approx(0.0, abs=5e-3)
    assert s[info_set_key(QUEEN, "b")][1] == pytest.approx(1 / 3, abs=5e-3)  # call rate
    assert s[info_set_key(KING, "b")][1] == pytest.approx(1.0, abs=5e-3)


def test_cfr_lands_inside_the_equilibrium_family():
    """Player 0's solution must satisfy the 3:1 value-bet-to-bluff ratio."""
    solver = CFRSolver("cfr+")
    solver.train(20000, snapshot_at=[])
    s = solver.average_strategy()
    alpha = s[info_set_key(JACK, "")][1]

    assert 0.0 <= alpha <= 1 / 3 + 1e-6
    assert s[info_set_key(KING, "")][1] == pytest.approx(3 * alpha, abs=5e-3)
    assert s[info_set_key(QUEEN, "")][1] == pytest.approx(0.0, abs=5e-3)
    assert s[info_set_key(QUEEN, "pb")][1] == pytest.approx(alpha + 1 / 3, abs=5e-3)


def test_average_strategy_converges_but_current_strategy_need_not():
    """
    The defining property of CFR, and the most common implementation mistake.
    Vanilla CFR's current strategy oscillates around the equilibrium forever;
    only the running average converges.
    """
    solver = CFRSolver("vanilla")
    solver.train(20000, snapshot_at=[])
    assert exploitability(solver.average_strategy()) < 2e-3
    assert exploitability(solver.current_strategy()) > 5e-2


def test_exploitability_decreases_monotonically_overall():
    solver = CFRSolver("cfr+")
    snaps = solver.train(5000)
    early = snaps[len(snaps) // 4]["exploitability"]
    late = snaps[-1]["exploitability"]
    assert late < early


def test_cfr_plus_beats_vanilla_by_orders_of_magnitude():
    """
    The regression test for the two bugs this solver was born with: applying
    the regret-matching+ floor per chance outcome instead of per iteration, and
    letting sigma^t drift between deals within one iteration. Either one
    silently drags CFR+ back to the vanilla 1/sqrt(T) rate.
    """
    budget = 10000
    vanilla = CFRSolver("vanilla"); vanilla.train(budget, snapshot_at=[])
    plus = CFRSolver("cfr+"); plus.train(budget, snapshot_at=[])
    assert exploitability(plus.average_strategy()) < \
        exploitability(vanilla.average_strategy()) / 50


def test_convergence_rate_is_at_least_inverse_sqrt_t():
    """Vanilla CFR's exploitability must fall at least as fast as O(1/sqrt(T))."""
    solver = CFRSolver("vanilla")
    solver.train(1000, snapshot_at=[])
    early = exploitability(solver.average_strategy())
    solver.train(9000, snapshot_at=[])
    late = exploitability(solver.average_strategy())
    assert late < early / math.sqrt(10) * 1.5


def test_solver_rejects_unknown_variant():
    with pytest.raises(ValueError):
        CFRSolver("mcts")


def test_log_spacing_is_sane():
    pts = log_spaced(100000)
    assert pts[0] == 1 and pts[-1] == 100000
    assert pts == sorted(set(pts))
    assert all(1 <= p <= 100000 for p in pts)
