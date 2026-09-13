/**
 * Counterfactual Regret Minimization. Port of `backend/app/core/cfr.py`.
 *
 * CFR is self-play driven by regret. It repeatedly walks the game tree and
 * asks, at every decision point, a purely local question: "how much better off
 * would I have been had I always played action a here, instead of what my
 * current strategy actually did?" Accumulate that, then play each action in
 * proportion to its positive accumulated regret (regret matching).
 *
 * Two results combine to make the local rule solve the global game:
 *   1. Regret matching is no-regret: average regret goes to 0 like O(1/sqrt(T)).
 *   2. In a two-player zero-sum game, if both players' average regret is below
 *      eps, their *average* strategies form a 2*eps-Nash equilibrium.
 *
 * The critical subtlety: it is the **average strategy** over all iterations
 * that converges to Nash, not the current strategy. The current strategy never
 * settles - it oscillates around the equilibrium forever. Reporting it is the
 * single most common way to get a plausible-looking but wrong solver, so the
 * two are kept strictly separate here.
 *
 * Variants: vanilla (Zinkevich 2007), cfr+ (Tammelin 2014), linear
 * (Brown & Sandholm 2019).
 */

import {
  ACTIONS, DEALS, DEAL_PROB, NUM_ACTIONS,
  allInfoSetKeys, currentPlayer, infoSetKey, isTerminal, terminalUtility,
  type Deal, type Strategy,
} from "./kuhn";

export const VARIANTS = ["vanilla", "cfr+", "linear"] as const;
export type Variant = (typeof VARIANTS)[number];

/**
 * Regret and strategy accumulators for one information set. Kuhn poker has
 * exactly 12; real poker abstractions have billions, but the per-node
 * bookkeeping is identical.
 */
class InfoSetNode {
  regretSum = [0, 0];
  /** Regret accrued this iteration, held separately so the whole iteration
   *  lands as one atomic update (see `applyRegrets`). */
  regretDelta = [0, 0];
  strategySum = [0, 0];
  strategy = [1 / NUM_ACTIONS, 1 / NUM_ACTIONS];

  constructor(readonly key: string) {}

  /**
   * Regret matching: play proportionally to positive cumulative regret.
   *
   * Called once per iteration, before any tree walking. Freezing sigma^t for
   * the whole iteration matters - CFR is defined over a *fixed* profile per
   * iteration, so recomputing it between one deal and the next would evaluate
   * each chance outcome against a slightly different opponent.
   */
  refreshStrategy(): void {
    const p0 = this.regretSum[0] > 0 ? this.regretSum[0] : 0;
    const p1 = this.regretSum[1] > 0 ? this.regretSum[1] : 0;
    const total = p0 + p1;
    if (total > 0) this.strategy = [p0 / total, p1 / total];
    else this.strategy = [1 / NUM_ACTIONS, 1 / NUM_ACTIONS];
  }

  /**
   * Commit this iteration's accumulated regret.
   *
   * The zero-floor of regret matching+ belongs *here*, applied once to the
   * iteration's full counterfactual regret summed over every chance outcome.
   * Clipping after each individual deal would let one deal zero the
   * accumulator before a later deal contributes, destroying information and
   * dragging CFR+ back down to the vanilla convergence rate.
   */
  applyRegrets(regretMatchingPlus: boolean): void {
    for (let i = 0; i < NUM_ACTIONS; i++) {
      const total = this.regretSum[i] + this.regretDelta[i];
      this.regretSum[i] = regretMatchingPlus ? Math.max(0, total) : total;
      this.regretDelta[i] = 0;
    }
  }

  /** The time-averaged strategy - this is the one that converges to Nash. */
  averageStrategy(): number[] {
    const total = this.strategySum[0] + this.strategySum[1];
    if (total > 0) return [this.strategySum[0] / total, this.strategySum[1] / total];
    return [1 / NUM_ACTIONS, 1 / NUM_ACTIONS];
  }
}

export interface Snapshot {
  iteration: number;
  elapsed_seconds: number;
  exploitability: number;
  percent_of_ante: number;
  milli_antes_per_hand: number;
  best_response_value_p0: number;
  best_response_value_p1: number;
  expected_value: number;
  game_value: number;
  alpha: number;
}

/**
 * A CFR solver for Kuhn poker with exact chance enumeration.
 *
 * Rather than dealing random cards, every iteration walks all six possible
 * deals weighted by their probability. That removes sampling variance
 * entirely, so the convergence curve is smooth and reproducible. Monte-Carlo
 * sampling (MCCFR) is what you reach for when the tree is too large to
 * enumerate; here it is not.
 */
export class CFRSolver {
  readonly nodes: Map<string, InfoSetNode>;
  readonly alternating: boolean;
  readonly regretMatchingPlus: boolean;
  iterations = 0;

  constructor(readonly variant: Variant = "cfr+") {
    if (!VARIANTS.includes(variant)) {
      throw new Error(`variant must be one of ${VARIANTS.join(", ")}; got ${variant}`);
    }
    this.nodes = new Map(allInfoSetKeys().map((k) => [k, new InfoSetNode(k)]));
    // Alternating updates walk the tree once per player per iteration, so each
    // player answers the other's freshly improved strategy rather than a stale
    // snapshot. On this game that single choice is worth more than regret
    // matching+ is; `backend/tests/test_solver.py` measures the ablation.
    this.alternating = variant === "cfr+" || variant === "linear";
    this.regretMatchingPlus = variant === "cfr+";
  }

  /**
   * Recursively walk the tree, returning the expected value to Player 0.
   *
   * `reach0`/`reach1` are how likely each player's own strategy is to produce
   * this history; `chance` is the deal probability. Keeping the three separate
   * is exactly what makes the counterfactual weighting below possible.
   */
  private walk(
    deal: Deal, history: string,
    reach0: number, reach1: number, chance: number,
    updatingPlayer: number | null,
    regretWeight: number, averageWeight: number,
  ): number {
    if (isTerminal(history)) return terminalUtility(history, deal);

    const player = currentPlayer(history);
    const node = this.nodes.get(infoSetKey(deal[player], history)) as InfoSetNode;
    const strategy = node.strategy; // frozen for this iteration
    const updating = updatingPlayer === null || player === updatingPlayer;

    // Accumulate the average strategy, weighted by this player's OWN reach. A
    // strategy is evidence about how to play an information set only in
    // proportion to how often this player actually arrives there.
    if (updating) {
      const ownReach = player === 0 ? reach0 : reach1;
      const contribution = ownReach * chance * averageWeight;
      if (contribution > 0) {
        node.strategySum[0] += contribution * strategy[0];
        node.strategySum[1] += contribution * strategy[1];
      }
    }

    const actionValues = [0, 0];
    for (let i = 0; i < ACTIONS.length; i++) {
      actionValues[i] = player === 0
        ? this.walk(deal, history + ACTIONS[i], reach0 * strategy[i], reach1,
                    chance, updatingPlayer, regretWeight, averageWeight)
        : this.walk(deal, history + ACTIONS[i], reach0, reach1 * strategy[i],
                    chance, updatingPlayer, regretWeight, averageWeight);
    }
    const nodeValue = strategy[0] * actionValues[0] + strategy[1] * actionValues[1];

    if (updating) {
      // Payoffs come back from Player 0's perspective; flip for Player 1.
      const sign = player === 0 ? 1 : -1;
      // The counterfactual weight: chance and the OPPONENT's reach, with this
      // player's own reach deliberately excluded. Dividing out one's own
      // probability of arriving here is what decouples the information sets
      // and lets a local rule solve the global game.
      const counterfactual = (player === 0 ? reach1 : reach0) * chance;
      if (counterfactual > 0) {
        for (let i = 0; i < NUM_ACTIONS; i++) {
          const regret = sign * (actionValues[i] - nodeValue);
          node.regretDelta[i] += counterfactual * regret * regretWeight;
        }
      }
    }

    return nodeValue;
  }

  /**
   * (regretWeight, averageWeight) for iteration t. These are genuinely
   * different knobs, and conflating them silently turns CFR+ into something no
   * faster than vanilla.
   *
   *   vanilla : every iteration counts equally, everywhere.
   *   cfr+    : regrets are UNWEIGHTED - the max(0, .) floor does the work -
   *             while the strategy average is linearly weighted, so later,
   *             better-informed iterations dominate the answer.
   *   linear  : both weighted by t, discounting the early iterations made
   *             before the strategy knew anything.
   */
  private weights(t: number): [number, number] {
    if (this.variant === "cfr+") return [1, t];
    if (this.variant === "linear") return [t, t];
    return [1, 1];
  }

  /** One full pass over all six deals, then one atomic regret update. */
  private traverse(updatingPlayer: number | null,
                   regretWeight: number, averageWeight: number): void {
    for (const node of this.nodes.values()) node.refreshStrategy();
    for (const deal of DEALS) {
      this.walk(deal, "", 1, 1, DEAL_PROB, updatingPlayer, regretWeight, averageWeight);
    }
    for (const node of this.nodes.values()) node.applyRegrets(this.regretMatchingPlus);
  }

  /** Run a single CFR iteration. */
  step(): void {
    this.iterations += 1;
    const [regretWeight, averageWeight] = this.weights(this.iterations);
    if (this.alternating) {
      // Player 0 improves against player 1's current strategy, then player 1
      // immediately answers the improved player 0.
      this.traverse(0, regretWeight, averageWeight);
      this.traverse(1, regretWeight, averageWeight);
    } else {
      // Simultaneous updates: both players learn from the same snapshot.
      this.traverse(null, regretWeight, averageWeight);
    }
  }

  /** Train synchronously for `n` iterations. */
  train(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /** The solved strategy: the time-average, which is what converges. */
  averageStrategy(): Strategy {
    const out: Strategy = {};
    for (const [key, node] of this.nodes) out[key] = node.averageStrategy();
    return out;
  }

  /**
   * The latest regret-matched strategy. Exposed because watching it oscillate
   * while the average converges is the clearest demonstration of why the
   * average is the one that matters.
   */
  currentStrategy(): Strategy {
    const out: Strategy = {};
    for (const [key, node] of this.nodes) out[key] = [...node.strategy];
    return out;
  }

  regrets(): Strategy {
    const out: Strategy = {};
    for (const [key, node] of this.nodes) out[key] = [...node.regretSum];
    return out;
  }
}

/**
 * Roughly log-spaced snapshot iterations in [1, iterations].
 *
 * Convergence is a power law, so it is a straight line on log-log axes only if
 * the samples are log-spaced. Linear spacing wastes almost every sample on the
 * flat tail.
 */
export function logSpaced(iterations: number, points = 60): number[] {
  if (iterations <= points) {
    return Array.from({ length: iterations }, (_, i) => i + 1);
  }
  const values = new Set<number>([1, iterations]);
  const logMax = Math.log10(iterations);
  for (let i = 0; i < points; i++) {
    values.add(Math.round(10 ** ((logMax * i) / (points - 1))));
  }
  return [...values].filter((v) => v >= 1 && v <= iterations).sort((a, b) => a - b);
}
