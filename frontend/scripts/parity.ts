/**
 * Emit the TypeScript solver's key numbers as JSON, for comparison against the
 * Python reference implementation.
 *
 * A port is only worth having if it is the same algorithm, and "looks right on
 * the dashboard" is not evidence of that. `scripts/check_parity.py` runs this
 * and the Python solver over identical budgets and asserts the outputs agree to
 * floating-point tolerance. CI runs it on every push.
 *
 * Only deterministic quantities are compared. The Monte-Carlo simulation is
 * deliberately excluded: the two languages use different PRNGs, so their
 * sampled streams differ by design. The exact enumerated EV that the simulation
 * exists to validate is included, and must match exactly.
 */

import { CFRSolver } from "../lib/solver/cfr";
import { exploitabilityReport } from "../lib/solver/bestResponse";
import { allBaselines } from "../lib/solver/baselines";
import { exploitability } from "../lib/solver/bestResponse";
import { duplicateEv, exploitativeAgent } from "../lib/solver/evaluate";
import { expectedValue, nashStrategy, nearestAlpha } from "../lib/solver/theory";
import { allInfoSetKeys } from "../lib/solver/kuhn";

const out: Record<string, unknown> = {};

// The analytic equilibrium, across the whole alpha family.
out.theory = [0, 1 / 12, 1 / 6, 0.25, 1 / 3].map((alpha) => {
  const strategy = nashStrategy(alpha);
  return {
    alpha,
    expected_value: expectedValue(strategy),
    exploitability: exploitability(strategy),
  };
});

// CFR under each variant at a budget small enough to run quickly in CI.
out.solvers = ["vanilla", "cfr+", "linear"].map((variant) => {
  const solver = new CFRSolver(variant as "vanilla" | "cfr+" | "linear");
  solver.train(20_000);
  const average = solver.averageStrategy();
  return {
    variant,
    iterations: solver.iterations,
    ...exploitabilityReport(average),
    expected_value: expectedValue(average),
    alpha: nearestAlpha(average),
    strategy: Object.fromEntries(
      allInfoSetKeys().map((k) => [k, average[k]]),
    ),
  };
});

// Baselines and the exact head-to-head numbers against a solved strategy.
const solver = new CFRSolver("cfr+");
solver.train(20_000);
const solved = solver.averageStrategy();
const pool = allBaselines();
out.baselines = Object.keys(pool).sort().map((name) => {
  const opponent = pool[name];
  return {
    name,
    exploitability: exploitability(opponent),
    nash_ev: duplicateEv(solved, opponent).ev_per_hand,
    exploitative_ev: duplicateEv(exploitativeAgent(opponent), opponent).ev_per_hand,
  };
});

process.stdout.write(JSON.stringify(out, null, 2));
