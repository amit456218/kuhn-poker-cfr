"""
In-memory state for the API: training runs and interactive play tables.

Everything lives in process. Kuhn poker solves in seconds and the whole solved
strategy is twelve pairs of floats, so persistence would be ceremony. A run is
a `CFRSolver` plus its convergence history; a table is one seat at a heads-up
game against a chosen opponent.

Training runs on a background thread so the dashboard can stream convergence
while it happens rather than blocking on a single long request.
"""

from __future__ import annotations

import random
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .core import baselines, theory
from .core.best_response import action_values, exploitability_report
from .core.cfr import CFRSolver, VARIANTS, log_spaced
from .core.kuhn import (
    ACTIONS, CARD_CHARS, CARD_NAMES, DEALS,
    action_label, current_player, info_set_key, is_terminal, pot_size,
    terminal_utility,
)

Strategy = Dict[str, List[float]]

MAX_ITERATIONS = 1_000_000

# A decision counts as a mistake only if it costs at least this many chips per
# hand. Against an equilibrium opponent almost every action is *deliberately*
# close to break-even - that is what an equilibrium does - so a threshold of
# "any loss at all" would flag correct play as a blunder on floating-point
# dust. Half a percent of an ante is the smallest error worth naming.
MISTAKE_THRESHOLD = 0.005


# --------------------------------------------------------------------------
# Training runs
# --------------------------------------------------------------------------

@dataclass
class Run:
    id: str
    variant: str
    requested_iterations: int
    status: str = "running"          # running | done | stopped | error
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    snapshots: List[dict] = field(default_factory=list)
    solver: Optional[CFRSolver] = None
    _stop: threading.Event = field(default_factory=threading.Event)

    @property
    def iterations(self) -> int:
        return self.solver.iterations if self.solver else 0

    @property
    def progress(self) -> float:
        if not self.requested_iterations:
            return 1.0
        return min(1.0, self.iterations / self.requested_iterations)

    def summary(self) -> dict:
        return {
            "run_id": self.id,
            "variant": self.variant,
            "status": self.status,
            "error": self.error,
            "requested_iterations": self.requested_iterations,
            "iterations": self.iterations,
            "progress": self.progress,
            "created_at": self.created_at,
            "latest": self.snapshots[-1] if self.snapshots else None,
        }


class RunStore:
    """Thread-safe registry of training runs."""

    def __init__(self) -> None:
        self._runs: Dict[str, Run] = {}
        self._lock = threading.Lock()

    def start(self, variant: str = "cfr+", iterations: int = 100_000) -> Run:
        if variant not in VARIANTS:
            raise ValueError("unknown variant %r; choose from %s"
                             % (variant, ", ".join(VARIANTS)))
        if not 1 <= iterations <= MAX_ITERATIONS:
            raise ValueError("iterations must be between 1 and %d" % MAX_ITERATIONS)

        run = Run(id=uuid.uuid4().hex[:12], variant=variant,
                  requested_iterations=iterations)
        run.solver = CFRSolver(variant)
        with self._lock:
            self._runs[run.id] = run

        thread = threading.Thread(target=self._train, args=(run,), daemon=True)
        thread.start()
        return run

    def _train(self, run: Run) -> None:
        try:
            run.solver.train(
                run.requested_iterations,
                snapshot_at=log_spaced(run.requested_iterations),
                on_snapshot=run.snapshots.append,
                should_stop=run._stop.is_set,
            )
            run.status = "stopped" if run._stop.is_set() else "done"
        except Exception as exc:                      # pragma: no cover
            run.status = "error"
            run.error = "%s: %s" % (type(exc).__name__, exc)

    def get(self, run_id: str) -> Optional[Run]:
        with self._lock:
            return self._runs.get(run_id)

    def stop(self, run_id: str) -> bool:
        run = self.get(run_id)
        if run is None or run.status != "running":
            return False
        run._stop.set()
        return True

    def list(self) -> List[dict]:
        with self._lock:
            runs = list(self._runs.values())
        return [r.summary() for r in sorted(runs, key=lambda r: -r.created_at)]

    def delete(self, run_id: str) -> bool:
        self.stop(run_id)
        with self._lock:
            return self._runs.pop(run_id, None) is not None


# --------------------------------------------------------------------------
# Interactive play
# --------------------------------------------------------------------------

@dataclass
class Hand:
    """One dealt hand in progress or just finished."""
    deal: Tuple[int, int]
    history: str = ""
    events: List[dict] = field(default_factory=list)
    finished: bool = False
    payoff_to_human: float = 0.0


@dataclass
class Table:
    id: str
    opponent_name: str
    opponent_strategy: Strategy
    human_seat: int
    coach: Dict[str, Dict[str, object]]
    rng: random.Random
    hands_played: int = 0
    net_chips: float = 0.0
    ev_lost: float = 0.0
    decisions: int = 0
    mistakes: int = 0
    completed: List[dict] = field(default_factory=list)
    current: Optional[Hand] = None


class TableStore:
    """
    Heads-up tables against a chosen opponent.

    The human's every decision is scored against the exact best response to the
    opponent actually being faced, so "you lost 0.17 chips there" is a real
    number and not a heuristic.
    """

    def __init__(self, solution_provider) -> None:
        self._tables: Dict[str, Table] = {}
        self._lock = threading.Lock()
        self._solution = solution_provider

    def opponent_strategy(self, name: str) -> Strategy:
        if name in ("nash", "solver", "equilibrium"):
            return self._solution()
        return baselines.get(name)

    def create(self, opponent: str = "nash", human_seat: int = 0,
               seed: Optional[int] = None) -> Table:
        if human_seat not in (0, 1):
            raise ValueError("human_seat must be 0 or 1")
        strategy = self.opponent_strategy(opponent)
        table = Table(
            id=uuid.uuid4().hex[:12],
            opponent_name=opponent,
            opponent_strategy=strategy,
            human_seat=human_seat,
            # Precomputed once: what each action is worth to the human, at
            # every spot they can face, against this specific opponent.
            coach=action_values(strategy, human_seat),
            rng=random.Random(seed),
        )
        with self._lock:
            self._tables[table.id] = table
        return table

    def get(self, table_id: str) -> Optional[Table]:
        with self._lock:
            return self._tables.get(table_id)

    # -- playing ---------------------------------------------------------

    def deal(self, table: Table) -> Table:
        """Start a fresh hand and let the bot act until it is the human's turn."""
        table.current = Hand(deal=DEALS[table.rng.randrange(len(DEALS))])
        self._advance_bot(table)
        return table

    def act(self, table: Table, action: str) -> Table:
        hand = table.current
        if hand is None or hand.finished:
            raise ValueError("no hand in progress; deal first")
        if action not in ACTIONS:
            raise ValueError("action must be 'p' (check/fold) or 'b' (bet/call)")
        if current_player(hand.history) != table.human_seat:
            raise ValueError("it is not your turn")

        key = info_set_key(hand.deal[table.human_seat], hand.history)
        entry = table.coach.get(key)
        chosen = ACTIONS.index(action)
        loss = float(entry["loss"][chosen]) if entry else 0.0

        hand.events.append({
            "actor": "you",
            "action": action,
            "label": action_label(hand.history, action),
            "history_before": hand.history,
            "info_set": key,
            "action_values": list(entry["values"]) if entry else None,
            "best_action": ACTIONS[int(entry["best"])] if entry else None,
            "best_action_label": action_label(hand.history, ACTIONS[int(entry["best"])]) if entry else None,
            "ev_lost": loss,
            "is_mistake": loss >= MISTAKE_THRESHOLD,
        })
        table.decisions += 1
        table.ev_lost += loss
        if loss >= MISTAKE_THRESHOLD:
            table.mistakes += 1

        hand.history += action
        self._advance_bot(table)
        return table

    def _advance_bot(self, table: Table) -> None:
        """Play the bot's turns until the human must act or the hand ends."""
        hand = table.current
        assert hand is not None
        bot_seat = 1 - table.human_seat

        while not is_terminal(hand.history) and current_player(hand.history) == bot_seat:
            key = info_set_key(hand.deal[bot_seat], hand.history)
            probs = table.opponent_strategy[key]
            action = ACTIONS[0] if table.rng.random() < probs[0] else ACTIONS[1]
            hand.events.append({
                "actor": "bot",
                "action": action,
                "label": action_label(hand.history, action),
                "history_before": hand.history,
                "info_set": key,
                # Revealed only in the finished-hand summary, never mid-hand -
                # the bot's frequencies for its own card would give it away.
                "strategy": list(probs),
            })
            hand.history += action

        if is_terminal(hand.history):
            self._finish(table)

    def _finish(self, table: Table) -> None:
        hand = table.current
        assert hand is not None
        payoff_p0 = terminal_utility(hand.history, hand.deal)
        hand.payoff_to_human = payoff_p0 if table.human_seat == 0 else -payoff_p0
        hand.finished = True

        table.hands_played += 1
        table.net_chips += hand.payoff_to_human
        table.completed.append({
            "history": hand.history,
            "your_card": CARD_CHARS[hand.deal[table.human_seat]],
            "bot_card": CARD_CHARS[hand.deal[1 - table.human_seat]],
            "payoff": hand.payoff_to_human,
        })

    # -- serialisation ---------------------------------------------------

    def state(self, table: Table) -> dict:
        hand = table.current
        payload: dict = {
            "table_id": table.id,
            "opponent": table.opponent_name,
            "opponent_description": baselines.DESCRIPTIONS.get(
                table.opponent_name,
                "The CFR-solved Nash equilibrium: unexploitable, and it will not "
                "adapt to your mistakes.",
            ),
            "human_seat": table.human_seat,
            "session": {
                "hands_played": table.hands_played,
                "net_chips": table.net_chips,
                "chips_per_hand": (table.net_chips / table.hands_played
                                   if table.hands_played else 0.0),
                "decisions": table.decisions,
                "mistakes": table.mistakes,
                "ev_lost": table.ev_lost,
                "ev_lost_per_decision": (table.ev_lost / table.decisions
                                         if table.decisions else 0.0),
                "accuracy": (1.0 - table.mistakes / table.decisions
                             if table.decisions else 1.0),
            },
            "recent": table.completed[-12:],
        }

        if hand is None:
            payload["hand"] = None
            return payload

        your_card = hand.deal[table.human_seat]
        your_turn = (not hand.finished
                     and current_player(hand.history) == table.human_seat)

        hand_payload: dict = {
            "history": hand.history,
            "finished": hand.finished,
            "your_card": CARD_CHARS[your_card],
            "your_card_name": CARD_NAMES[your_card],
            "pot": pot_size(hand.history),
            "your_turn": your_turn,
            "events": self._visible_events(hand),
        }

        if your_turn:
            key = info_set_key(your_card, hand.history)
            entry = table.coach.get(key)
            hand_payload["info_set"] = key
            hand_payload["legal_actions"] = [
                {"action": a, "label": action_label(hand.history, a)} for a in ACTIONS
            ]
            # The hint is available but the UI keeps it behind a toggle, so the
            # player can commit to a decision before seeing the answer.
            hand_payload["hint"] = {
                "action_values": list(entry["values"]),
                "best_action": ACTIONS[int(entry["best"])],
            } if entry else None

        if hand.finished:
            bot_card = hand.deal[1 - table.human_seat]
            hand_payload["bot_card"] = CARD_CHARS[bot_card]
            hand_payload["bot_card_name"] = CARD_NAMES[bot_card]
            hand_payload["payoff"] = hand.payoff_to_human
            hand_payload["showdown"] = hand.history in ("pp", "bb", "pbb")
            hand_payload["your_ev_lost"] = sum(
                float(e.get("ev_lost") or 0.0) for e in hand.events
                if e["actor"] == "you"
            )

        payload["hand"] = hand_payload
        return payload

    @staticmethod
    def _visible_events(hand: Hand) -> List[dict]:
        """Hide the bot's per-card frequencies until the hand is over."""
        visible = []
        for event in hand.events:
            item = dict(event)
            if not hand.finished and item["actor"] == "bot":
                item.pop("strategy", None)
                item.pop("info_set", None)
            visible.append(item)
        return visible


__all__ = ["Run", "RunStore", "Table", "TableStore",
           "MAX_ITERATIONS", "MISTAKE_THRESHOLD"]
