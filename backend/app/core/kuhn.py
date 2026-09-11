"""
Kuhn Poker: the game definition.

Kuhn poker (Kuhn, 1950) is the smallest poker variant that still contains the
strategic essentials of real poker: private information, bluffing, and
slow-playing. It is small enough that its Nash equilibria are known in closed
form, which makes it the ideal benchmark for verifying a CFR implementation.

Rules
-----
  * Deck of three cards: Jack < Queen < King.
  * Two players. Both ante 1 chip, so the pot starts at 2.
  * Each player is dealt one private card; the third is never revealed.
  * Player 0 acts first and may CHECK or BET 1.
      - After a check, Player 1 may CHECK (showdown) or BET 1.
          - Facing that bet, Player 0 may FOLD or CALL.
      - After a bet, Player 1 may FOLD or CALL.
  * At a showdown the higher card wins the pot.

Encoding
--------
Actions are single characters so a history is just a string:

    'p' = pass  (check when there is no bet, fold when facing one)
    'b' = bet   (bet when there is no bet, call when facing one)

The five terminal histories, with payoffs from Player 0's perspective in net
chips (the ante is already sunk, so these are wins/losses relative to zero):

    'pp'    both check      -> showdown for a pot of 2, winner nets +-1
    'bp'    P0 bets, P1 folds -> P0 nets +1
    'bb'    P0 bets, P1 calls  -> showdown for a pot of 4, winner nets +-2
    'pbp'   P1 bets, P0 folds -> P0 nets -1
    'pbb'   P1 bets, P0 calls -> showdown for a pot of 4, winner nets +-2

An *information set* is everything a player knows when acting: their own card
plus the public history. There are 12 of them, 6 per player. That tiny number
is why the whole game can be solved exactly, and why CFR converges in
milliseconds.
"""

from __future__ import annotations

from itertools import permutations
from typing import Dict, List, Optional, Tuple

# --- Cards -----------------------------------------------------------------

JACK, QUEEN, KING = 0, 1, 2
CARDS: Tuple[int, int, int] = (JACK, QUEEN, KING)
CARD_CHARS: Tuple[str, str, str] = ("J", "Q", "K")
CARD_NAMES: Tuple[str, str, str] = ("Jack", "Queen", "King")

# --- Actions ---------------------------------------------------------------

PASS, BET = "p", "b"
ACTIONS: Tuple[str, str] = (PASS, BET)
NUM_ACTIONS = 2

ANTE = 1

# Every possible deal: an ordered pair (player 0's card, player 1's card).
# All 6 are equally likely, so we enumerate them exactly rather than sampling.
# This removes every drop of Monte-Carlo noise from the solver.
DEALS: Tuple[Tuple[int, int], ...] = tuple(permutations(CARDS, 2))
DEAL_PROB = 1.0 / len(DEALS)


def action_label(history: str, action: str) -> str:
    """Human-readable name for an action, which depends on whether a bet is live."""
    facing_bet = history.endswith(BET)
    if action == PASS:
        return "Fold" if facing_bet else "Check"
    return "Call" if facing_bet else "Bet"


def is_terminal(history: str) -> bool:
    return history in ("pp", "bp", "bb", "pbp", "pbb")


def current_player(history: str) -> int:
    """Whose turn it is. Player 0 acts on even-length histories."""
    return len(history) % 2


def legal_actions(history: str) -> Tuple[str, str]:
    """Both actions are always legal at every decision node in Kuhn poker."""
    return ACTIONS


def terminal_utility(history: str, cards: Tuple[int, int]) -> float:
    """
    Payoff to Player 0 at a terminal history, in net chips.

    `cards[i]` is player i's private card. Showdowns are decided by card rank;
    folds are decided by who folded, regardless of cards.
    """
    if not is_terminal(history):
        raise ValueError("not a terminal history: %r" % (history,))

    p0_wins_showdown = cards[0] > cards[1]

    if history == "pp":          # checked down, small pot
        return 1.0 if p0_wins_showdown else -1.0
    if history == "bp":          # P0 bet, P1 folded
        return 1.0
    if history == "pbp":         # P1 bet, P0 folded
        return -1.0
    # 'bb' and 'pbb': someone bet and was called, big pot
    return 2.0 if p0_wins_showdown else -2.0


def info_set_key(card: int, history: str) -> str:
    """
    The label identifying an information set, e.g. 'K', 'Qpb', 'Jb'.

    This is the whole point of imperfect information: the acting player knows
    only their own card and the public history, never the opponent's card. Two
    game states that differ solely in the opponent's card share one key, so the
    player is forced to use one strategy across both.
    """
    return CARD_CHARS[card] + history


def describe_info_set(key: str) -> Dict[str, object]:
    """Decompose an info set key into a structured, UI-friendly description."""
    card_char, history = key[0], key[1:]
    player = current_player(history)
    facing_bet = history.endswith(BET)

    if history == "":
        situation = "You open the betting"
    elif history == "p":
        situation = "Opponent checked to you"
    elif history == "b":
        situation = "Opponent bet into you"
    elif history == "pb":
        situation = "You checked, opponent bet"
    else:
        situation = history

    return {
        "key": key,
        "card": card_char,
        "card_name": CARD_NAMES[CARD_CHARS.index(card_char)],
        "history": history,
        "player": player,
        "facing_bet": facing_bet,
        "situation": situation,
        "actions": [action_label(history, a) for a in ACTIONS],
        "pot": pot_size(history),
    }


def pot_size(history: str) -> int:
    """Chips in the pot when this decision is faced (both antes plus any bet)."""
    return 2 * ANTE + history.count(BET)


def all_info_set_keys() -> List[str]:
    """
    The 12 information sets of Kuhn poker, in a stable display order:
    Player 0's opening decisions, Player 1's responses, then Player 0 facing a bet.
    """
    keys: List[str] = []
    for history in ("", "p", "b", "pb"):
        for card in CARDS:
            keys.append(info_set_key(card, history))
    return keys


def enumerate_histories() -> List[str]:
    """Every reachable history in the game tree, terminals included."""
    out: List[str] = []
    frontier = [""]
    while frontier:
        h = frontier.pop(0)
        out.append(h)
        if not is_terminal(h):
            for a in ACTIONS:
                frontier.append(h + a)
    return out


def game_tree() -> Dict[str, object]:
    """
    A serialisable description of the betting tree, for rendering in the UI.
    Chance (the deal) is not part of this tree; it sits above the root.
    """

    def build(history: str) -> Dict[str, object]:
        node: Dict[str, object] = {
            "history": history,
            "pot": pot_size(history),
            "terminal": is_terminal(history),
        }
        if is_terminal(history):
            node["outcome"] = _terminal_description(history)
            node["payoffs"] = {
                "showdown": history in ("pp", "bb", "pbb"),
                "amount": abs(terminal_utility(history, (KING, JACK))),
            }
        else:
            node["player"] = current_player(history)
            node["children"] = {
                action_label(history, a): build(history + a) for a in ACTIONS
            }
        return node

    return build("")


def _terminal_description(history: str) -> str:
    """
    Outcome text for the UI, using 1-indexed player names.

    Internally seats are 0 and 1, because that is what `len(history) % 2`
    gives. Everything user-facing counts from 1, the way a person at a table
    would. Mixing the two conventions in the same view is a real source of
    confusion, so the translation happens here and nowhere else.
    """
    return {
        "pp": "Both checked - showdown for 2 chips, high card wins 1",
        "bp": "Player 2 folded - Player 1 wins 1",
        "bb": "Bet and called - showdown for 4 chips, high card wins 2",
        "pbp": "Player 1 folded - Player 2 wins 1",
        "pbb": "Bet and called - showdown for 4 chips, high card wins 2",
    }[history]


__all__ = [
    "JACK", "QUEEN", "KING", "CARDS", "CARD_CHARS", "CARD_NAMES",
    "PASS", "BET", "ACTIONS", "NUM_ACTIONS", "ANTE", "DEALS", "DEAL_PROB",
    "action_label", "is_terminal", "current_player", "legal_actions",
    "terminal_utility", "info_set_key", "describe_info_set", "pot_size",
    "all_info_set_keys", "enumerate_histories", "game_tree",
]
