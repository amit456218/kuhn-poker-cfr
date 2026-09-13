#!/usr/bin/env python3
"""
Assert that the browser solver and the Python reference are the same algorithm.

The dashboard ships a TypeScript port of the solver so the site can be static
(see frontend/lib/solver/). A port that silently drifts from its reference is
worse than no port at all: the README's numbers come from the Python side, and
the live demo would be quietly reporting something else.

So this runs both over identical budgets and compares every deterministic
quantity - the analytic equilibrium family, all three CFR variants' converged
strategies and exploitability, and the exact head-to-head EV against every
baseline. CFR here is fully deterministic (chance is enumerated, not sampled),
so agreement should be to floating-point noise, not to a loose tolerance.

The Monte-Carlo simulation is deliberately excluded: Python uses the Mersenne
Twister and the port uses mulberry32, so their sampled streams differ by design.
The exact enumerated EV that the simulation exists to validate *is* compared.

Usage:  python3 scripts/check_parity.py
Exit:   0 if every value agrees, 1 otherwise (with the worst offenders printed).
"""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
sys.path.insert(0, str(ROOT / "backend"))

# CFR is deterministic on both sides, so the only source of disagreement is
# floating-point association order. Anything larger is a real divergence.
TOLERANCE = 1e-9


def typescript_numbers() -> dict:
    """Compile the TS solver and run its parity emitter."""
    build = pathlib.Path(tempfile.mkdtemp(prefix="kuhn-parity-"))
    try:
        sources = sorted(str(p) for p in (FRONTEND / "lib" / "solver").glob("*.ts"))
        subprocess.run(
            ["npx", "tsc", *sources, str(FRONTEND / "scripts" / "parity.ts"),
             "--outDir", str(build), "--module", "commonjs", "--target", "es2020",
             "--moduleResolution", "node", "--skipLibCheck", "--esModuleInterop"],
            cwd=FRONTEND, check=True, capture_output=True, text=True,
        )
        result = subprocess.run(
            ["node", str(build / "scripts" / "parity.js")],
            check=True, capture_output=True, text=True,
        )
        return json.loads(result.stdout)
    finally:
        shutil.rmtree(build, ignore_errors=True)


def python_numbers() -> dict:
    """The same quantities, from the reference implementation."""
    from app.core.baselines import all_baselines
    from app.core.best_response import exploitability, exploitability_report
    from app.core.cfr import CFRSolver
    from app.core.evaluate import duplicate_ev, exploitative_agent
    from app.core.kuhn import all_info_set_keys
    from app.core.theory import expected_value, nash_strategy, nearest_alpha

    out: dict = {}
    out["theory"] = []
    for alpha in (0, 1 / 12, 1 / 6, 0.25, 1 / 3):
        strategy = nash_strategy(alpha)
        out["theory"].append({
            "alpha": alpha,
            "expected_value": expected_value(strategy),
            "exploitability": exploitability(strategy),
        })

    out["solvers"] = []
    for variant in ("vanilla", "cfr+", "linear"):
        solver = CFRSolver(variant)
        solver.train(20_000, snapshot_at=[])
        average = solver.average_strategy()
        out["solvers"].append({
            "variant": variant,
            "iterations": solver.iterations,
            **exploitability_report(average),
            "expected_value": expected_value(average),
            "alpha": nearest_alpha(average),
            "strategy": {k: average[k] for k in all_info_set_keys()},
        })

    solver = CFRSolver("cfr+")
    solver.train(20_000, snapshot_at=[])
    solved = solver.average_strategy()
    pool = all_baselines()
    out["baselines"] = []
    for name in sorted(pool):
        opponent = pool[name]
        out["baselines"].append({
            "name": name,
            "exploitability": exploitability(opponent),
            "nash_ev": duplicate_ev(solved, opponent)["ev_per_hand"],
            "exploitative_ev": duplicate_ev(
                exploitative_agent(opponent), opponent)["ev_per_hand"],
        })
    return out


def compare(ts, py, path="") -> list[tuple[str, float, float, float]]:
    """Walk both structures in parallel, collecting every numeric disagreement."""
    failures: list[tuple[str, float, float, float]] = []

    if isinstance(py, dict):
        assert isinstance(ts, dict), f"{path}: shape mismatch"
        for key in py:
            failures += compare(ts[key], py[key], f"{path}.{key}")
    elif isinstance(py, list):
        assert len(ts) == len(py), f"{path}: length {len(ts)} != {len(py)}"
        for i, (a, b) in enumerate(zip(ts, py)):
            failures += compare(a, b, f"{path}[{i}]")
    elif isinstance(py, (int, float)) and not isinstance(py, bool):
        delta = abs(float(ts) - float(py))
        if delta > TOLERANCE:
            failures.append((path, float(ts), float(py), delta))
    elif ts != py:
        failures.append((path, ts, py, float("nan")))

    return failures


def main() -> int:
    print("Compiling and running the TypeScript solver...")
    ts = typescript_numbers()
    print("Running the Python reference solver...")
    py = python_numbers()

    failures = compare(ts, py)
    checked = len(json.dumps(py).split(","))

    if failures:
        print(f"\nFAIL: {len(failures)} value(s) diverged (tolerance {TOLERANCE:g})\n")
        for path, a, b, delta in sorted(failures, key=lambda f: -f[3])[:20]:
            print(f"  {path}\n      typescript {a!r}\n      python     {b!r}\n      delta      {delta:g}")
        return 1

    print(f"\nOK: the TypeScript port and the Python reference agree "
          f"to within {TOLERANCE:g} on every compared value.")
    print(f"    ~{checked} numbers checked across the equilibrium family, "
          f"all three CFR variants, and 7 baselines.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
