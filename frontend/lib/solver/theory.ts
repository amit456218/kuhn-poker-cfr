/**
 * The closed-form Nash equilibria of Kuhn poker. Port of
 * `backend/app/core/theory.py`.
 *
 * This module is the project's ground truth. Because Kuhn (1950) solved this
 * game analytically, CFR can be checked against a *known correct answer*
 * instead of merely against the claim that it converged to something.
 *
 * Player 0 has a one-parameter family of equilibria indexed by alpha in
 * [0, 1/3]; Player 1's equilibrium is unique. Game value: -1/18 to Player 0.
 *
 * Two facts here are the ones worth internalising, because they are why poker
 * is not solved by "bet good hands, fold bad ones":
 *
 *   * The bluffing rate is forced. Player 0 must bluff the Jack sometimes.
 *     Betting only Kings makes a bet perfectly readable.
 *   * The calling rate is forced. Player 1 must call the Queen exactly 1/3 of
 *     the time - the rate that makes bluffing break even, which is what removes
 *     the opponent's incentive to deviate.
 *
 * The K:J bluff ratio of 3:1 is the same balance arithmetic that governs bet
 * sizing in real poker.
 */

import {
  ACTIONS, DEALS, DEAL_PROB, JACK, KING, QUEEN,
  currentPlayer, infoSetKey, isTerminal, terminalUtility,
  type Deal, type Strategy,
} from "./kuhn";

/** Exact game value to Player 0. */
export const GAME_VALUE = -1 / 18;
export const ALPHA_MIN = 0;
export const ALPHA_MAX = 1 / 3;

/**
 * Build an exact equilibrium profile for a given alpha, as a map from
 * information-set key to [P(pass), P(bet)]. Default alpha = 1/6 sits in the
 * middle of the family.
 */
export function nashStrategy(alpha = 1 / 6): Strategy {
  if (!(alpha >= ALPHA_MIN - 1e-12 && alpha <= ALPHA_MAX + 1e-12)) {
    throw new Error(`alpha must lie in [0, 1/3]; got ${alpha}`);
  }
  const a = Math.min(Math.max(alpha, ALPHA_MIN), ALPHA_MAX);
  const mix = (betProb: number): number[] => [1 - betProb, betProb];

  return {
    // Player 0, opening decision.
    [infoSetKey(JACK, "")]: mix(a),          // the bluff
    [infoSetKey(QUEEN, "")]: mix(0),         // never bet the middle card
    [infoSetKey(KING, "")]: mix(3 * a),      // value bets, 3:1 against bluffs
    // Player 0, checked then faced a bet.
    [infoSetKey(JACK, "pb")]: mix(0),        // always fold
    [infoSetKey(QUEEN, "pb")]: mix(a + 1 / 3),
    [infoSetKey(KING, "pb")]: mix(1),        // always call
    // Player 1, facing a check (unique).
    [infoSetKey(JACK, "p")]: mix(1 / 3),     // forced bluff rate
    [infoSetKey(QUEEN, "p")]: mix(0),
    [infoSetKey(KING, "p")]: mix(1),
    // Player 1, facing a bet (unique).
    [infoSetKey(JACK, "b")]: mix(0),         // always fold
    [infoSetKey(QUEEN, "b")]: mix(1 / 3),    // the forced call rate
    [infoSetKey(KING, "b")]: mix(1),
  };
}

function walk(deal: Deal, history: string, strategy: Strategy): number {
  if (isTerminal(history)) return terminalUtility(history, deal);
  const player = currentPlayer(history);
  const probs = strategy[infoSetKey(deal[player], history)];
  let value = 0;
  for (let i = 0; i < ACTIONS.length; i++) {
    if (probs[i] > 0) value += probs[i] * walk(deal, history + ACTIONS[i], strategy);
  }
  return value;
}

/**
 * Exact expected value to Player 0 of a full strategy profile, by enumerating
 * all 6 deals and every branch. No sampling, no variance: the true EV.
 */
export function expectedValue(strategy: Strategy): number {
  let total = 0;
  for (const deal of DEALS) total += DEAL_PROB * walk(deal, "", strategy);
  return total;
}

/**
 * Recover which member of the equilibrium family a solved strategy is closest
 * to, by reading off Player 0's Jack-bluff frequency. CFR does not pick alpha
 * for you, so reporting it explains *which* of the infinitely many equilibria
 * it landed on.
 */
export function nearestAlpha(strategy: Strategy): number {
  const alpha = strategy[infoSetKey(JACK, "")][1];
  return Math.min(Math.max(alpha, ALPHA_MIN), ALPHA_MAX);
}

/**
 * Per-information-set absolute deviation from the best-matching equilibrium.
 *
 * Player 1's six entries are the meaningful test: that half of the profile is
 * unique, so a correct solver must reproduce those numbers exactly. Player 0's
 * entries are expected to differ across runs only through alpha.
 */
export function deviationFromFamily(strategy: Strategy): Record<string, number> {
  const reference = nashStrategy(nearestAlpha(strategy));
  const out: Record<string, number> = {};
  for (const key of Object.keys(reference)) {
    out[key] = Math.abs(strategy[key][1] - reference[key][1]);
  }
  return out;
}

export const THEORY_NOTES = [
  "Kuhn poker has a one-parameter family of equilibria, indexed by alpha in " +
    "[0, 1/3]. Alpha is how often Player 1 bluffs the Jack.",
  "Player 2's equilibrium strategy is unique, so a correct solver must " +
    "reproduce those six numbers exactly.",
  "Every member of the family is worth exactly -1/18 chips per hand to " +
    "Player 1. Moving first is a structural disadvantage here.",
  "Player 1 must bet the King exactly 3x as often as the Jack. That 3:1 " +
    "value-to-bluff ratio is what makes the bets unreadable.",
  "Player 2 must call the Queen exactly 1/3 of the time - the rate that makes " +
    "bluffing break even and removes any reason to bluff.",
];
