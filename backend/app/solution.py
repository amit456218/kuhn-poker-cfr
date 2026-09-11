"""
The process-wide default solution served by the API.

Solving Kuhn poker takes seconds, not hours, but a few seconds is still too
long to sit inside the first HTTP request. So the server solves a coarse
strategy synchronously at startup - good to about 1e-5 exploitability, which is
already far past the point of mattering for play - and then refines it to the
headline iteration count on a background thread, swapping the result in when it
is ready.

Readers are never blocked and never see a partially written strategy: the
refined solution is published by rebinding a single attribute, which is atomic
under the GIL.
"""

from __future__ import annotations

import threading
import time
from typing import Dict, List, Optional

from .core.best_response import exploitability_report
from .core.cfr import CFRSolver
from .core.theory import GAME_VALUE, expected_value, nearest_alpha

Strategy = Dict[str, List[float]]

WARMUP_ITERATIONS = 25_000
REFINED_ITERATIONS = 250_000
VARIANT = "cfr+"


class DefaultSolution:
    def __init__(self) -> None:
        self._strategy: Optional[Strategy] = None
        self._iterations = 0
        self._solve_seconds = 0.0
        self._refining = False
        self._lock = threading.Lock()

    def warm_up(self) -> None:
        """Solve coarsely up front, then refine in the background."""
        started = time.perf_counter()
        solver = CFRSolver(VARIANT)
        solver.train(WARMUP_ITERATIONS, snapshot_at=[])
        with self._lock:
            self._strategy = solver.average_strategy()
            self._iterations = solver.iterations
            self._solve_seconds = time.perf_counter() - started
            self._refining = True
        threading.Thread(target=self._refine, daemon=True).start()

    def _refine(self) -> None:
        started = time.perf_counter()
        solver = CFRSolver(VARIANT)
        solver.train(REFINED_ITERATIONS, snapshot_at=[])
        with self._lock:
            self._strategy = solver.average_strategy()
            self._iterations = solver.iterations
            self._solve_seconds = time.perf_counter() - started
            self._refining = False

    def strategy(self) -> Strategy:
        with self._lock:
            if self._strategy is None:
                self.warm_up()
            return self._strategy

    def report(self) -> dict:
        strategy = self.strategy()
        with self._lock:
            iterations, seconds, refining = (
                self._iterations, self._solve_seconds, self._refining)
        metrics = exploitability_report(strategy)
        return {
            "variant": VARIANT,
            "iterations": iterations,
            "solve_seconds": seconds,
            "refining": refining,
            "strategy": strategy,
            "alpha": nearest_alpha(strategy),
            "expected_value": expected_value(strategy),
            "game_value": GAME_VALUE,
            **metrics,
        }


DEFAULT_SOLUTION = DefaultSolution()

__all__ = ["DEFAULT_SOLUTION", "DefaultSolution",
           "WARMUP_ITERATIONS", "REFINED_ITERATIONS"]
