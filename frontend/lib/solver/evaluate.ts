/**
 * Head-to-head evaluation: exact expected value, Monte-Carlo simulation, and
 * the statistics needed to say whether a measured edge is real. Port of
 * `backend/app/core/evaluate.py`.
 *
 * Seat matters, so both seats get played. Kuhn poker is not symmetric - the
 * first player is worth -1/18 chips per hand at equilibrium - so every result
 * here is *duplicate-scored*: each pairing is played from both seats and
 * averaged, which cancels the positional term exactly.
 *
 * Exact beats sampled when exact is available. Both a CFR solution and a
 * rule-based baseline are fixed strategies, so their head-to-head EV can be
 * enumerated. The Monte-Carlo path exists to *validate* that number and to
 * produce realistic hand-by-hand variance, not because an estimate is needed.
 *
 * An estimate without an interval is not a result. In this game a single hand
 * swings +-2 chips while a strong edge is ~0.2 chips/hand, so a few hundred
 * hands can easily show the wrong sign.
 */

import { bestResponse, bestResponseStrategy, exploitability } from "./bestResponse";
import {
  ACTIONS, DEALS, DEAL_PROB,
  currentPlayer, infoSetKey, isTerminal, terminalUtility,
  type Deal, type Strategy,
} from "./kuhn";

/** One strategy used in both seats, or a [player0, player1] pair. The
 *  exploitative agent needs the pair form, because the best response to an
 *  opponent depends on which seat you sit in. */
export type Seated = Strategy | [Strategy, Strategy];

function seat(strategy: Seated, index: number): Strategy {
  return Array.isArray(strategy) ? strategy[index] : strategy;
}

/**
 * The maximally exploitative counter-strategy to `opponent`, one per seat.
 * Contrast with the equilibrium: this wins the most possible against this
 * specific opponent, and would be crushed by an opponent who noticed.
 */
export function exploitativeAgent(opponent: Strategy): [Strategy, Strategy] {
  return [bestResponseStrategy(opponent, 0), bestResponseStrategy(opponent, 1)];
}

/** Exact EV to Player 0 when the two seats use different strategies. */
export function exactEv(p0: Strategy, p1: Strategy): number {
  const walk = (deal: Deal, history: string): number => {
    if (isTerminal(history)) return terminalUtility(history, deal);
    const player = currentPlayer(history);
    const probs = (player === 0 ? p0 : p1)[infoSetKey(deal[player], history)];
    let total = 0;
    for (let i = 0; i < ACTIONS.length; i++) {
      if (probs[i] > 0) total += probs[i] * walk(deal, history + ACTIONS[i]);
    }
    return total;
  };
  let total = 0;
  for (const deal of DEALS) total += DEAL_PROB * walk(deal, "");
  return total;
}

export interface DuplicateEv {
  ev_as_player0: number;
  ev_as_player1: number;
  ev_per_hand: number;
  milli_antes_per_hand: number;
}

/**
 * Seat-balanced EV to `strategy`, in chips per hand. Playing both seats removes
 * the structural -1/18 first-player disadvantage, so the number reflects
 * strategy quality alone.
 */
export function duplicateEv(strategy: Seated, opponent: Strategy): DuplicateEv {
  const asP0 = exactEv(seat(strategy, 0), opponent);
  const asP1 = -exactEv(opponent, seat(strategy, 1));
  const mean = (asP0 + asP1) / 2;
  return {
    ev_as_player0: asP0,
    ev_as_player1: asP1,
    ev_per_hand: mean,
    milli_antes_per_hand: mean * 1000,
  };
}

/**
 * How much EV equilibrium play leaves on the table against a specific flawed
 * opponent.
 *
 * The most misunderstood property of a Nash strategy, worth stating plainly: an
 * equilibrium does not try to win the maximum. It guarantees it cannot *lose*
 * more than the game value, whoever it faces. A best response to this
 * particular opponent earns strictly more, but is itself wide open to a
 * counter-adjustment. The gap is the price of that safety.
 */
export function exploitativeGap(strategy: Seated, opponent: Strategy): {
  equilibrium_ev: number; max_exploit_ev: number; gap: number;
} {
  const nashSide = duplicateEv(strategy, opponent).ev_per_hand;
  const maxExploit =
    (bestResponse(opponent, 0).value + bestResponse(opponent, 1).value) / 2;
  return {
    equilibrium_ev: nashSide,
    max_exploit_ev: maxExploit,
    gap: maxExploit - nashSide,
  };
}

/**
 * mulberry32: a small, fast, seedable PRNG.
 *
 * The Python reference uses the Mersenne Twister, so simulated streams differ
 * between the two implementations. That is expected and harmless - the
 * simulation exists to validate the *exact* enumerated EV, and that exact
 * number is identical in both. What matters here is only that runs are
 * reproducible, which a seeded generator gives.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal CDF, via an Abramowitz-Stegun approximation to erf. */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export interface Simulation {
  hands: number;
  ev_per_hand: number;
  stdev: number;
  standard_error: number;
  ci95_low: number;
  ci95_high: number;
  p_value: number;
  significant_at_95: boolean;
  win_rate: number;
  showdown_rate: number;
  fold_rate: number;
  exact_ev_per_hand: number;
  exact_within_ci95: boolean;
  standard_errors_from_exact: number;
}

function playHand(deal: Deal, p0: Strategy, p1: Strategy, rng: () => number): [number, string] {
  let history = "";
  while (!isTerminal(history)) {
    const player = currentPlayer(history);
    const probs = (player === 0 ? p0 : p1)[infoSetKey(deal[player], history)];
    history += rng() < probs[0] ? ACTIONS[0] : ACTIONS[1];
  }
  return [terminalUtility(history, deal), history];
}

/**
 * Play `hands` hands, alternating seats every hand so the sample is
 * seat-balanced by construction, and report the result with its uncertainty.
 */
export function simulate(strategy: Seated, opponent: Strategy,
                         hands = 100_000, seed = 42): Simulation {
  if (hands <= 0) throw new Error("hands must be positive");
  const rng = mulberry32(seed);
  let total = 0, totalSq = 0, wins = 0, showdowns = 0;

  for (let i = 0; i < hands; i++) {
    const deal = DEALS[Math.floor(rng() * DEALS.length)];
    let payoff: number, history: string;
    if (i % 2 === 0) {
      [payoff, history] = playHand(deal, seat(strategy, 0), opponent, rng);
    } else {
      [payoff, history] = playHand(deal, opponent, seat(strategy, 1), rng);
      payoff = -payoff; // flip to our perspective
    }
    total += payoff;
    totalSq += payoff * payoff;
    if (payoff > 0) wins++;
    if (history === "pp" || history === "bb" || history === "pbb") showdowns++;
  }

  const mean = total / hands;
  const variance = Math.max(0, totalSq / hands - mean * mean);
  const stdev = Math.sqrt(variance);
  const sem = hands > 1 ? stdev / Math.sqrt(hands) : Infinity;
  // Null hypothesis: the true per-hand edge is zero. With n in the tens of
  // thousands the t-distribution is indistinguishable from the normal.
  const z = sem > 0 ? mean / sem : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const halfWidth = 1.959963985 * sem;
  const exact = duplicateEv(strategy, opponent).ev_per_hand;

  return {
    hands,
    ev_per_hand: mean,
    stdev,
    standard_error: sem,
    ci95_low: mean - halfWidth,
    ci95_high: mean + halfWidth,
    p_value: pValue,
    significant_at_95: pValue < 0.05,
    win_rate: wins / hands,
    showdown_rate: showdowns / hands,
    fold_rate: (hands - showdowns) / hands,
    exact_ev_per_hand: exact,
    // The validation that matters: does the sampled mean land inside its own
    // interval around the analytically known answer?
    exact_within_ci95: mean - halfWidth <= exact && exact <= mean + halfWidth,
    standard_errors_from_exact: sem > 0 ? Math.abs(mean - exact) / sem : 0,
  };
}

/**
 * Hands needed to resolve an edge at 95% confidence. Included because the
 * number surprises people: sample size scales with the *square* of the inverse
 * edge, so halving the edge you want to detect quadruples the hands you need.
 */
export function requiredHands(edge: number, stdev = 1, z = 1.959963985): number {
  if (edge <= 0) throw new Error("edge must be positive");
  return Math.ceil(((z * stdev) / edge) ** 2);
}

export { exploitability };
