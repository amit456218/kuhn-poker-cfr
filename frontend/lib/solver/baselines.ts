/**
 * Rule-based opponents to measure the solved strategy against. Port of
 * `backend/app/core/baselines.py`.
 *
 * Exploitability tells you how a strategy fares against a *perfect* adversary.
 * That is the right worst-case number, but it says nothing about how the
 * strategy does against the flawed opponents it will actually meet. These
 * supply that second axis.
 *
 * The names are the classic poker archetypes because they fail in the classic
 * ways: the Calling Station cannot be bluffed but pays off every value bet, the
 * Maniac bluffs itself broke, the Rock folds away its equity, and the Honest
 * player - the one most beginners write first - loses precisely because it is
 * readable.
 */

import { CARD_CHARS, JACK, KING, QUEEN, allInfoSetKeys, type Strategy } from "./kuhn";

/** Build a strategy from a function of (card, history) -> P(bet/call). */
function build(betProbability: (card: number, history: string) => number): Strategy {
  const strategy: Strategy = {};
  for (const key of allInfoSetKeys()) {
    const card = CARD_CHARS.indexOf(key[0]);
    const history = key.slice(1);
    const p = betProbability(card, history);
    strategy[key] = [1 - p, p];
  }
  return strategy;
}

export const BASELINES: Record<string, () => Strategy> = {
  /** Never bets, never folds. Checks everything down and calls every bet. */
  calling_station: () => build((_c, h) => (h.endsWith("b") ? 1 : 0)),
  /** Bets and calls with everything. Maximum aggression, zero selectivity. */
  maniac: () => build(() => 1),
  /** Never bets, folds to every bet. Surrenders the pot on any resistance. */
  rock: () => build(() => 0),
  /**
   * Bets and calls only with the King. The strategy almost everyone writes
   * first, and the most instructive one to lose with: it never bluffs off
   * chips and never calls light, yet it is among the most exploitable
   * strategies in the game, because every bet is perfectly readable and every
   * check invites a free steal.
   */
  honest: () => build((card) => (card === KING ? 1 : 0)),
  /**
   * A competent heuristic: value-bet the King, call down with King and Queen,
   * fold the Jack. Sensible, disciplined, and still missing the one thing that
   * matters - it never bluffs, so it can never win a pot it did not deserve.
   */
  tight_aggressive: () => build((card, history) =>
    history.endsWith("b")
      ? (card === KING || card === QUEEN ? 1 : 0)
      : (card === KING ? 1 : 0)),
  /**
   * Bluffs the Jack far too often (75%) while playing the rest reasonably.
   * Fails in the opposite direction to `honest`, and the equilibrium punishes
   * it without ever changing its own plan.
   */
  naive_bluffer: () => build((card, history) => {
    if (history.endsWith("b")) return card === KING ? 1 : card === QUEEN ? 0.5 : 0;
    if (card === KING) return 1;
    if (card === JACK) return 0.75;
    return 0;
  }),
  /** Coin-flips every decision. The floor any real strategy must clear. */
  random: () => build(() => 0.5),
};

export const DESCRIPTIONS: Record<string, string> = {
  calling_station: "Checks everything, calls every bet. Impossible to bluff, pays off every value bet.",
  maniac: "Bets and calls with everything. Pure aggression with no selectivity.",
  rock: "Never bets, folds to any bet. Gives up the pot at the first sign of resistance.",
  honest: "Bets and calls only the King. The intuitive strategy - and a very exploitable one.",
  tight_aggressive: "Value-bets the King, calls with King and Queen, folds the Jack. Sensible but never bluffs.",
  naive_bluffer: "Bluffs the Jack 75% of the time. Aggressive in the wrong spots.",
  random: "Coin-flips every decision.",
};

export const NASH_DESCRIPTION =
  "The CFR-solved Nash equilibrium: unexploitable, and it will not adapt to your mistakes.";

export function get(name: string): Strategy {
  const factory = BASELINES[name];
  if (!factory) {
    throw new Error(
      `unknown baseline ${name}; choose from ${Object.keys(BASELINES).sort().join(", ")}`);
  }
  return factory();
}

export function allBaselines(): Record<string, Strategy> {
  return Object.fromEntries(Object.entries(BASELINES).map(([n, f]) => [n, f()]));
}

export function label(name: string): string {
  return name.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}
