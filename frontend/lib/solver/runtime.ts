/**
 * The local runtime: everything the FastAPI backend used to do, in the browser.
 *
 * Ports of the API layer in `backend/app/api/` and the run store in
 * `backend/app/store.py`. Long solves are chunked and yield to the event loop
 * between chunks, so the page stays responsive and the convergence curve
 * streams in exactly as it did over server-sent events.
 */

import * as baselines from "./baselines";
import { exploitability, exploitabilityReport } from "./bestResponse";
import { CFRSolver, VARIANTS, logSpaced, type Snapshot, type Variant } from "./cfr";
import * as evaluate from "./evaluate";
import {
  CARD_CHARS, CARD_NAMES, DEALS,
  allInfoSetKeys, describeInfoSet, enumerateHistories, gameTree, type Strategy,
} from "./kuhn";
import { createTable, getTable, type TableState } from "./play";
import {
  GAME_VALUE, ALPHA_MIN, ALPHA_MAX, THEORY_NOTES,
  deviationFromFamily, expectedValue, nashStrategy, nearestAlpha,
} from "./theory";

export const MAX_ITERATIONS = 1_000_000;

/**
 * How long to compute before handing control back to the browser, in ms.
 *
 * Time-sliced rather than counted in iterations, because the two differ by 50x
 * across the variants and machines this runs on. Staying under a frame keeps
 * the page interactive and the chart animating while the solver works.
 */
const SLICE_MS = 12;

/**
 * Yield to the event loop via MessageChannel rather than setTimeout.
 *
 * setTimeout is clamped to ~4ms, and Chrome throttles it to once per second in
 * background tabs - which would turn a sub-second solve into a minute-long one
 * the moment the user switches tabs. A MessageChannel round-trip has neither
 * penalty. The setTimeout fallback is for non-browser hosts (tests, SSR).
 */
const yieldToBrowser: () => Promise<void> =
  typeof MessageChannel === "undefined"
    ? () => new Promise<void>((r) => setTimeout(r, 0))
    : () => new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          resolve();
        };
        channel.port2.postMessage(undefined);
      });

// --------------------------------------------------------------------------
// Training runs
// --------------------------------------------------------------------------

interface Run {
  id: string;
  variant: Variant;
  requested_iterations: number;
  status: "running" | "done" | "stopped" | "error";
  error: string | null;
  snapshots: Snapshot[];
  solver: CFRSolver;
  stop: boolean;
}

const RUNS = new Map<string, Run>();

function snapshotOf(solver: CFRSolver, elapsed: number): Snapshot {
  const average = solver.averageStrategy();
  const report = exploitabilityReport(average);
  return {
    iteration: solver.iterations,
    elapsed_seconds: elapsed,
    exploitability: report.exploitability,
    percent_of_ante: report.percent_of_ante,
    milli_antes_per_hand: report.milli_antes_per_hand,
    best_response_value_p0: report.best_response_value_p0,
    best_response_value_p1: report.best_response_value_p1,
    expected_value: expectedValue(average),
    game_value: GAME_VALUE,
    alpha: nearestAlpha(average),
  };
}

function summary(run: Run) {
  return {
    run_id: run.id,
    variant: run.variant,
    status: run.status,
    error: run.error,
    requested_iterations: run.requested_iterations,
    iterations: run.solver.iterations,
    progress: run.solver.iterations / run.requested_iterations,
    latest: run.snapshots.length ? run.snapshots[run.snapshots.length - 1] : null,
  };
}

async function driveRun(run: Run): Promise<void> {
  const targets = new Set(logSpaced(run.requested_iterations));
  const started = performance.now();
  try {
    while (run.solver.iterations < run.requested_iterations && !run.stop) {
      const sliceEnd = performance.now() + SLICE_MS;
      do {
        run.solver.step();
        if (targets.has(run.solver.iterations)) {
          run.snapshots.push(snapshotOf(run.solver, (performance.now() - started) / 1000));
        }
      } while (run.solver.iterations < run.requested_iterations
               && !run.stop && performance.now() < sliceEnd);
      await yieldToBrowser();
    }
    run.status = run.stop ? "stopped" : "done";
  } catch (err) {
    run.status = "error";
    run.error = err instanceof Error ? err.message : String(err);
  }
}

function startRun(variant: string, iterations: number) {
  if (!VARIANTS.includes(variant as Variant)) {
    throw new Error(`variant must be one of ${VARIANTS.join(", ")}; got ${variant}`);
  }
  if (!Number.isFinite(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new Error(`iterations must be between 1 and ${MAX_ITERATIONS}`);
  }
  const run: Run = {
    id: Math.random().toString(16).slice(2, 14),
    variant: variant as Variant,
    requested_iterations: iterations,
    status: "running",
    error: null,
    snapshots: [],
    solver: new CFRSolver(variant as Variant),
    stop: false,
  };
  RUNS.set(run.id, run);
  void driveRun(run);
  return summary(run);
}

function getRun(id: string) {
  const run = RUNS.get(id);
  if (!run) throw new Error("no such run");
  const average = run.solver.averageStrategy();
  return {
    ...summary(run),
    snapshots: run.snapshots,
    strategy: average,
    // Shipped alongside on purpose: seeing the current strategy oscillate while
    // the average settles is the clearest demonstration of why CFR's answer is
    // the time-average and not the latest iterate.
    current_strategy: run.solver.currentStrategy(),
    regrets: run.solver.regrets(),
    alpha: nearestAlpha(average),
    deviation: deviationFromFamily(average),
    ...exploitabilityReport(average),
  };
}


/**
 * Subscribe to a run's snapshots as they are produced.
 *
 * Stands in for the server-sent events the FastAPI backend used to push. The
 * run advances on the event loop in chunks, so a short poll picks up new
 * snapshots as they appear and the convergence curve draws while the solver is
 * still working - the same behaviour, without the server.
 */
function streamRun(
  id: string,
  handlers: {
    onSnapshot: (snapshot: Snapshot) => void;
    onEnd: () => void;
    onError: (message: string) => void;
  },
): { close: () => void } {
  let sent = 0;
  let closed = false;

  const timer = setInterval(() => {
    if (closed) return;
    const run = RUNS.get(id);
    if (!run) {
      closed = true;
      clearInterval(timer);
      handlers.onError("no such run");
      return;
    }
    while (sent < run.snapshots.length) handlers.onSnapshot(run.snapshots[sent++]);
    if (run.status !== "running" && sent >= run.snapshots.length) {
      closed = true;
      clearInterval(timer);
      if (run.status === "error") handlers.onError(run.error ?? "the run failed");
      else handlers.onEnd();
    }
  }, 40);

  return {
    close: () => {
      closed = true;
      clearInterval(timer);
    },
  };
}

// --------------------------------------------------------------------------
// The default solution the app plays and coaches against
// --------------------------------------------------------------------------

const WARMUP_ITERATIONS = 25_000;
const REFINED_ITERATIONS = 250_000;

/**
 * Solve coarsely up front, then refine in the background.
 *
 * The warm-up is good to about 1e-5 exploitability, already far past the point
 * of mattering for play; the refinement swaps in when ready. Readers never
 * block and never see a partially written strategy.
 */
const solution = (() => {
  let strategy: Strategy | null = null;
  let iterations = 0;
  let solveSeconds = 0;
  let refining = false;

  const ensure = (): Strategy => {
    if (strategy) return strategy;
    const started = performance.now();
    const solver = new CFRSolver("cfr+");
    solver.train(WARMUP_ITERATIONS);
    strategy = solver.averageStrategy();
    iterations = solver.iterations;
    solveSeconds = (performance.now() - started) / 1000;
    refining = true;
    void refine();
    return strategy;
  };

  const refine = async (): Promise<void> => {
    const started = performance.now();
    const solver = new CFRSolver("cfr+");
    while (solver.iterations < REFINED_ITERATIONS) {
      const sliceEnd = performance.now() + SLICE_MS;
      do {
        solver.step();
      } while (solver.iterations < REFINED_ITERATIONS && performance.now() < sliceEnd);
      await yieldToBrowser();
    }
    strategy = solver.averageStrategy();
    iterations = solver.iterations;
    solveSeconds = (performance.now() - started) / 1000;
    refining = false;
  };

  return {
    strategy: ensure,
    report: () => {
      const s = ensure();
      return {
        variant: "cfr+",
        iterations,
        solve_seconds: solveSeconds,
        refining,
        strategy: s,
        alpha: nearestAlpha(s),
        expected_value: expectedValue(s),
        game_value: GAME_VALUE,
        ...exploitabilityReport(s),
      };
    },
  };
})();

// --------------------------------------------------------------------------
// Ablation
// --------------------------------------------------------------------------

const ABLATION_CACHE = new Map<number, unknown>();

/**
 * Run all three CFR variants under an identical budget and compare.
 *
 * This is the experiment that caught two real bugs in this solver: applying the
 * regret-matching+ floor per chance outcome instead of per iteration, and
 * letting sigma^t drift between deals inside one iteration. Either leaves CFR+
 * converging at vanilla's 1/sqrt(T) rate - which looks fine in isolation and is
 * obvious the moment the variants are plotted together.
 */
async function ablation(iterations: number) {
  if (ABLATION_CACHE.has(iterations)) return ABLATION_CACHE.get(iterations);

  const results = [];
  for (const variant of VARIANTS) {
    const solver = new CFRSolver(variant);
    const targets = new Set(logSpaced(iterations));
    const snapshots: Snapshot[] = [];
    const started = performance.now();
    while (solver.iterations < iterations) {
      const sliceEnd = performance.now() + SLICE_MS;
      do {
        solver.step();
        if (targets.has(solver.iterations)) {
          snapshots.push(snapshotOf(solver, (performance.now() - started) / 1000));
        }
      } while (solver.iterations < iterations && performance.now() < sliceEnd);
      await yieldToBrowser();
    }
    const average = solver.averageStrategy();
    results.push({
      variant,
      alternating_updates: solver.alternating,
      regret_matching_plus: solver.regretMatchingPlus,
      iterations: solver.iterations,
      snapshots,
      final_exploitability: exploitability(average),
      current_strategy_exploitability: exploitability(solver.currentStrategy()),
      alpha: nearestAlpha(average),
    });
  }

  const best = results.reduce((a, b) => (a.final_exploitability <= b.final_exploitability ? a : b));
  const worst = results.reduce((a, b) => (a.final_exploitability >= b.final_exploitability ? a : b));
  const payload = {
    iterations,
    results,
    speedup: best.final_exploitability > 0
      ? worst.final_exploitability / best.final_exploitability : null,
    best_variant: best.variant,
    findings: [
      "Vanilla CFR converges at the theoretical O(1/sqrt(T)) rate.",
      "Alternating updates - each player answering the opponent's freshly " +
        "improved strategy rather than a stale snapshot - are worth ~23x on " +
        "this game against ~2x for regret matching+ alone. The ingredient CFR+ " +
        "is named for is the smaller half of it.",
      "Vanilla CFR's current strategy never converges; it orbits the " +
        "equilibrium indefinitely. Only the running average settles. CFR+ is " +
        "the exception - regret matching+ makes the current iterate converge too.",
    ],
  };
  ABLATION_CACHE.set(iterations, payload);
  return payload;
}

// --------------------------------------------------------------------------
// Evaluation
// --------------------------------------------------------------------------

interface EvaluationRow {
  opponent: string;
  label: string;
  description: string;
  opponent_exploitability: number;
  nash: evaluate.DuplicateEv & {
    equilibrium_ev: number;
    max_exploit_ev: number;
    gap: number;
    simulation: evaluate.Simulation;
  };
  exploitative: evaluate.DuplicateEv & { simulation: evaluate.Simulation };
}

async function evaluateStrategy(hands: number, runId?: string) {
  let strategy: Strategy;
  let source: { run_id: string | null; iterations: number; variant: string };

  if (runId) {
    const run = RUNS.get(runId);
    if (!run) throw new Error("no such run");
    strategy = run.solver.averageStrategy();
    source = { run_id: runId, iterations: run.solver.iterations, variant: run.variant };
  } else {
    const report = solution.report();
    strategy = report.strategy;
    source = { run_id: null, iterations: report.iterations, variant: report.variant };
  }

  const pool = baselines.allBaselines();
  const rows: EvaluationRow[] = [];
  for (const name of Object.keys(pool).sort()) {
    const opponent = pool[name];
    const agent = evaluate.exploitativeAgent(opponent);
    rows.push({
      opponent: name,
      label: baselines.label(name),
      description: baselines.DESCRIPTIONS[name],
      opponent_exploitability: exploitability(opponent),
      nash: {
        ...evaluate.duplicateEv(strategy, opponent),
        ...evaluate.exploitativeGap(strategy, opponent),
        simulation: evaluate.simulate(strategy, opponent, hands),
      },
      exploitative: {
        ...evaluate.duplicateEv(agent, opponent),
        simulation: evaluate.simulate(agent, opponent, hands),
      },
    });
    await yieldToBrowser();
  }

  rows.sort((a, b) => b.nash.ev_per_hand - a.nash.ev_per_hand);
  const mean = (f: (r: EvaluationRow) => number) =>
    rows.reduce((s, r) => s + f(r), 0) / rows.length;

  return {
    source,
    hands_per_matchup: hands,
    exploitability: exploitability(strategy),
    results: rows,
    summary: {
      nash_mean_ev: mean((r) => r.nash.ev_per_hand),
      nash_mean_win_rate: mean((r) => r.nash.simulation.win_rate),
      exploitative_mean_ev: mean((r) => r.exploitative.ev_per_hand),
      exploitative_mean_win_rate: mean((r) => r.exploitative.simulation.win_rate),
    },
    reading_the_table: [
      "EV is duplicate-scored: every matchup is played from both seats and " +
        "averaged, which cancels the -1/18 first-player disadvantage.",
      "Exact EV is enumerated over all six deals, so it carries no sampling " +
        "error. The simulation exists to validate it and to give realistic " +
        "hand-to-hand variance.",
      "The equilibrium earns exactly zero against several baselines. That is " +
        "correct, not a bug: an equilibrium makes its opponent indifferent, so " +
        "it never punishes their errors. It guarantees you cannot lose; it " +
        "does not try to win.",
      "Win rate is a weak measure in poker - card luck dominates it. Chips per " +
        "hand is the number that matters.",
    ],
  };
}

// --------------------------------------------------------------------------
// The dispatch surface, matching the old HTTP client one-for-one
// --------------------------------------------------------------------------

export const runtime = {
  health: () => ({ status: "ok" }),

  rules: () => ({
    name: "Kuhn Poker",
    players: 2,
    deck: CARD_CHARS.map((c, i) => ({ char: c, name: CARD_NAMES[i], rank: i })),
    ante: 1,
    bet_size: 1,
    actions: [
      { code: "p", no_bet: "Check", facing_bet: "Fold" },
      { code: "b", no_bet: "Bet", facing_bet: "Call" },
    ],
    deals: DEALS.length,
    info_sets: allInfoSetKeys().length,
    histories: enumerateHistories(),
    tree: gameTree(),
    steps: [
      "Both players ante 1 chip, so the pot starts at 2.",
      "Each player is dealt one of three cards: Jack, Queen or King. The third card is never shown.",
      "Player 1 acts first and may check or bet 1 chip.",
      "If Player 1 checks, Player 2 may check (ending the hand at showdown) or bet. " +
        "Player 1 may then fold or call.",
      "If Player 1 bets, Player 2 may fold or call.",
      "At a showdown the higher card wins the pot. A fold gives the pot to the player " +
        "who did not fold, whatever the cards were.",
    ],
  }),

  infoSets: () => ({ info_sets: allInfoSetKeys().map(describeInfoSet) }),

  theory: (alpha: number) => {
    if (!(alpha >= ALPHA_MIN && alpha <= ALPHA_MAX)) {
      throw new Error(`alpha must lie in [0, 1/3]; got ${alpha}`);
    }
    const strategy = nashStrategy(alpha);
    return {
      alpha,
      alpha_range: [ALPHA_MIN, ALPHA_MAX],
      strategy,
      game_value: GAME_VALUE,
      expected_value: expectedValue(strategy),
      exploitability: exploitability(strategy),
      notes: THEORY_NOTES,
    };
  },

  baselines: () => {
    const rows = Object.entries(baselines.allBaselines()).map(([name, strategy]) => ({
      name,
      label: baselines.label(name),
      description: baselines.DESCRIPTIONS[name],
      exploitability: exploitability(strategy),
      strategy,
    }));
    rows.sort((a, b) => b.exploitability - a.exploitability);
    return { baselines: rows };
  },

  solution: () => solution.report(),
  startRun,
  getRun,
  streamRun,
  stopRun: (id: string) => {
    const run = RUNS.get(id);
    if (!run) throw new Error("no such run");
    const wasRunning = run.status === "running";
    run.stop = true;
    return { stopped: wasRunning };
  },
  ablation,
  evaluate: evaluateStrategy,

  newTable: (opponent: string, humanSeat: number): TableState =>
    createTable(opponent, humanSeat, solution.strategy()).state(),
  deal: (id: string): TableState => getTable(id).deal().state(),
  act: (id: string, action: string): TableState => getTable(id).act(action).state(),
};
