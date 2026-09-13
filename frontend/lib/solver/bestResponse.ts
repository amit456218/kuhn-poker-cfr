/**
 * Exact best response and exploitability. Port of
 * `backend/app/core/best_response.py`.
 *
 * Exploitability is the only honest scoreboard for a poker solver. "The
 * strategy stopped changing" proves nothing; a solver can converge confidently
 * to a non-equilibrium. Exploitability asks the real question: if a perfectly
 * informed adversary knew our strategy and played the single best counter to
 * it, how much would we lose?
 *
 *     eps = ( BR_0(sigma_1) + BR_1(sigma_0) ) / 2
 *
 * At a Nash equilibrium BR_0 = v and BR_1 = -v, so the sum cancels and eps = 0.
 * Elsewhere it is strictly positive.
 *
 * The subtle part is that the maximisation must happen at the *information
 * set*, not at individual game states. A best responder still cannot see the
 * opponent's card, so it must commit to one action across every deal
 * consistent with what it observes. Taking a max at each history separately
 * would silently grant it clairvoyance and report an exploitability that is
 * too high.
 */

import {
  ACTIONS, CARDS, DEALS, DEAL_PROB,
  allInfoSetKeys, currentPlayer, infoSetKey, isTerminal, terminalUtility,
  type Deal, type Strategy,
} from "./kuhn";

/**
 * The histories at which each player acts, ordered deepest-first so a decision
 * is only scored once everything beneath it has been settled.
 */
const DECISION_HISTORIES: Record<number, string[]> = {
  0: ["pb", ""],
  1: ["p", "b"],
};

export interface ActionValueEntry {
  counterfactual: number[];
  reach: number;
  values: number[];
  best: number;
  loss: number[];
}

/**
 * Probability that the opponent's own choices lead to `history`. The best
 * responder's actions along the way are skipped on purpose - this is the
 * "counterfactual" in counterfactual value.
 */
function opponentReach(history: string, deal: Deal, strategy: Strategy, brPlayer: number): number {
  let reach = 1;
  for (let depth = 0; depth < history.length; depth++) {
    const actor = depth % 2;
    if (actor === brPlayer) continue;
    const key = infoSetKey(deal[actor], history.slice(0, depth));
    reach *= strategy[key][ACTIONS.indexOf(history[depth])];
  }
  return reach;
}

/**
 * Value to `brPlayer` from `history` onward, with the opponent following
 * `strategy` and the best responder following the already-decided `brActions`.
 */
function valueFrom(history: string, deal: Deal, strategy: Strategy,
                   brPlayer: number, brActions: Record<string, number>): number {
  if (isTerminal(history)) {
    const utility = terminalUtility(history, deal);
    return brPlayer === 0 ? utility : -utility;
  }
  const actor = currentPlayer(history);
  const key = infoSetKey(deal[actor], history);

  if (actor === brPlayer) {
    return valueFrom(history + ACTIONS[brActions[key]], deal, strategy, brPlayer, brActions);
  }
  const probs = strategy[key];
  let total = 0;
  for (let i = 0; i < ACTIONS.length; i++) {
    if (probs[i] > 0) {
      total += probs[i] * valueFrom(history + ACTIONS[i], deal, strategy, brPlayer, brActions);
    }
  }
  return total;
}

function solve(strategy: Strategy, brPlayer: number): {
  value: number;
  actions: Record<string, number>;
  table: Record<string, ActionValueEntry>;
} {
  const brActions: Record<string, number> = {};
  const table: Record<string, ActionValueEntry> = {};

  for (const history of DECISION_HISTORIES[brPlayer]) {
    for (const card of CARDS) {
      const key = infoSetKey(card, history);
      const counterfactual = [0, 0];
      let reach = 0;

      for (const deal of DEALS) {
        if (deal[brPlayer] !== card) continue; // this deal is not in the info set
        const weight = DEAL_PROB * opponentReach(history, deal, strategy, brPlayer);
        if (weight === 0) continue;
        reach += weight;
        for (let i = 0; i < ACTIONS.length; i++) {
          counterfactual[i] += weight * valueFrom(
            history + ACTIONS[i], deal, strategy, brPlayer, brActions);
        }
      }

      // Ties resolve to pass; any tie-break is equally optimal by definition.
      brActions[key] = counterfactual[0] >= counterfactual[1] ? 0 : 1;
      // Normalising by the reach turns "counterfactual value" into the
      // plain-English quantity a player wants: the average chips this action is
      // worth *given* you are actually in this spot.
      const normalized = reach > 0 ? counterfactual.map((c) => c / reach) : [0, 0];
      const bestValue = Math.max(...normalized);
      table[key] = {
        counterfactual,
        reach,
        values: normalized,
        best: brActions[key],
        loss: normalized.map((v) => bestValue - v),
      };
    }
  }

  let value = 0;
  for (const deal of DEALS) {
    value += DEAL_PROB * valueFrom("", deal, strategy, brPlayer, brActions);
  }
  return { value, actions: brActions, table };
}

/** Compute the best response to `strategy` for `brPlayer`. */
export function bestResponse(strategy: Strategy, brPlayer: number): {
  value: number; actions: Record<string, number>;
} {
  const { value, actions } = solve(strategy, brPlayer);
  return { value, actions };
}

/**
 * Per-information-set, per-action expected values against `strategy`.
 *
 * This is what turns the solver into a coach: at any spot, what is checking
 * worth here, what is betting worth, and how much did the move you actually
 * made cost you - measured against this specific opponent, in chips per hand.
 */
export function actionValues(strategy: Strategy, brPlayer: number): Record<string, ActionValueEntry> {
  return solve(strategy, brPlayer).table;
}

/** Exploitability in chips per hand. Zero exactly at a Nash equilibrium. */
export function exploitability(strategy: Strategy): number {
  return (bestResponse(strategy, 0).value + bestResponse(strategy, 1).value) / 2;
}

export interface ExploitabilityReport {
  exploitability: number;
  best_response_value_p0: number;
  best_response_value_p1: number;
  milli_antes_per_hand: number;
  percent_of_ante: number;
}

/**
 * Exploitability with the per-player breakdown. `milli_antes` is chips/hand x
 * 1000, the Kuhn analogue of the mbb/hand unit standard in poker-AI papers.
 */
export function exploitabilityReport(strategy: Strategy): ExploitabilityReport {
  const v0 = bestResponse(strategy, 0).value;
  const v1 = bestResponse(strategy, 1).value;
  const eps = (v0 + v1) / 2;
  return {
    exploitability: eps,
    best_response_value_p0: v0,
    best_response_value_p1: v1,
    milli_antes_per_hand: eps * 1000,
    percent_of_ante: eps * 100,
  };
}

/**
 * The best response rendered as a playable strategy, for use as an
 * *exploitative* agent.
 *
 * A best response is always deterministic - it knows exactly which opponent it
 * faces, so there is nothing to hide and no reason to randomise. That is also
 * its weakness: it maximises against this one opponent and is wide open to
 * anyone who adapts. Equilibrium play is the opposite trade, and the dashboard
 * runs both so the trade-off is visible rather than asserted.
 */
export function bestResponseStrategy(opponent: Strategy, brPlayer: number): Strategy {
  const { actions } = bestResponse(opponent, brPlayer);
  const strategy: Strategy = {};
  for (const key of allInfoSetKeys()) strategy[key] = [0.5, 0.5];
  for (const [key, index] of Object.entries(actions)) {
    strategy[key] = index === 0 ? [1, 0] : [0, 1];
  }
  return strategy;
}
