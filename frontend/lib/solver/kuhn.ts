/**
 * Kuhn Poker: the game definition.
 *
 * A direct port of `backend/app/core/kuhn.py`. The Python implementation
 * remains the reference; this exists so the dashboard can run the whole solver
 * in the browser with no server behind it. `npm run parity` checks the two
 * against each other numerically.
 *
 * Rules
 * -----
 *   * Deck of three cards: Jack < Queen < King.
 *   * Two players. Both ante 1 chip, so the pot starts at 2.
 *   * Each player is dealt one private card; the third is never revealed.
 *   * Player 0 acts first and may CHECK or BET 1.
 *   * At a showdown the higher card wins the pot.
 *
 * Actions are single characters, so a history is just a string:
 *   'p' = pass (check with no bet live, fold when facing one)
 *   'b' = bet  (bet with no bet live, call when facing one)
 */

export const JACK = 0;
export const QUEEN = 1;
export const KING = 2;
export const CARDS: readonly number[] = [JACK, QUEEN, KING];
export const CARD_CHARS: readonly string[] = ["J", "Q", "K"];
export const CARD_NAMES: readonly string[] = ["Jack", "Queen", "King"];

export const PASS = "p";
export const BET = "b";
export const ACTIONS: readonly string[] = [PASS, BET];
export const NUM_ACTIONS = 2;
export const ANTE = 1;

export type Deal = readonly [number, number];
export type Strategy = Record<string, number[]>;

/**
 * Every possible deal, as (player 0's card, player 1's card). All 6 are equally
 * likely and are enumerated exactly rather than sampled, which removes every
 * drop of Monte-Carlo noise from the solver.
 */
export const DEALS: readonly Deal[] = (() => {
  const out: Deal[] = [];
  for (const a of CARDS) for (const b of CARDS) if (a !== b) out.push([a, b]);
  return out;
})();
export const DEAL_PROB = 1 / DEALS.length;

const TERMINALS = new Set(["pp", "bp", "bb", "pbp", "pbb"]);

export function isTerminal(history: string): boolean {
  return TERMINALS.has(history);
}

/** Whose turn it is. Player 0 acts on even-length histories. */
export function currentPlayer(history: string): number {
  return history.length % 2;
}

/** Human-readable name for an action, which depends on whether a bet is live. */
export function actionLabel(history: string, action: string): string {
  const facingBet = history.endsWith(BET);
  if (action === PASS) return facingBet ? "Fold" : "Check";
  return facingBet ? "Call" : "Bet";
}

/**
 * Payoff to Player 0 at a terminal history, in net chips. Showdowns are decided
 * by card rank; folds by who folded, regardless of cards.
 */
export function terminalUtility(history: string, cards: Deal): number {
  const p0WinsShowdown = cards[0] > cards[1];
  if (history === "pp") return p0WinsShowdown ? 1 : -1;
  if (history === "bp") return 1;
  if (history === "pbp") return -1;
  // 'bb' and 'pbb': someone bet and was called, big pot.
  return p0WinsShowdown ? 2 : -2;
}

/**
 * The label identifying an information set, e.g. 'K', 'Qpb', 'Jb'.
 *
 * This is the whole point of imperfect information: the acting player knows
 * only their own card and the public history, never the opponent's. Two game
 * states differing solely in the opponent's card share one key, so the player
 * is forced to use one strategy across both.
 */
export function infoSetKey(card: number, history: string): string {
  return CARD_CHARS[card] + history;
}

/** Chips in the pot when this decision is faced (both antes plus any bets). */
export function potSize(history: string): number {
  return 2 * ANTE + (history.match(/b/g) ?? []).length;
}

/** The 12 information sets, in a stable display order. */
export function allInfoSetKeys(): string[] {
  const keys: string[] = [];
  for (const history of ["", "p", "b", "pb"]) {
    for (const card of CARDS) keys.push(infoSetKey(card, history));
  }
  return keys;
}

/** Every reachable history in the game tree, terminals included. */
export function enumerateHistories(): string[] {
  const out: string[] = [];
  const frontier: string[] = [""];
  while (frontier.length) {
    const h = frontier.shift() as string;
    out.push(h);
    if (!isTerminal(h)) for (const a of ACTIONS) frontier.push(h + a);
  }
  return out;
}

export interface InfoSetInfo {
  key: string;
  card: string;
  card_name: string;
  history: string;
  player: number;
  facing_bet: boolean;
  situation: string;
  actions: string[];
  pot: number;
}

export function describeInfoSet(key: string): InfoSetInfo {
  const cardChar = key[0];
  const history = key.slice(1);
  const situation =
    history === "" ? "You open the betting"
    : history === "p" ? "Opponent checked to you"
    : history === "b" ? "Opponent bet into you"
    : history === "pb" ? "You checked, opponent bet"
    : history;

  return {
    key,
    card: cardChar,
    card_name: CARD_NAMES[CARD_CHARS.indexOf(cardChar)],
    history,
    player: currentPlayer(history),
    facing_bet: history.endsWith(BET),
    situation,
    actions: ACTIONS.map((a) => actionLabel(history, a)),
    pot: potSize(history),
  };
}

export interface TreeNode {
  history: string;
  pot: number;
  terminal: boolean;
  player?: number;
  outcome?: string;
  payoffs?: { showdown: boolean; amount: number };
  children?: Record<string, TreeNode>;
}

const TERMINAL_DESCRIPTIONS: Record<string, string> = {
  pp: "Both checked - showdown for 2 chips, high card wins 1",
  bp: "Player 2 folded - Player 1 wins 1",
  bb: "Bet and called - showdown for 4 chips, high card wins 2",
  pbp: "Player 1 folded - Player 2 wins 1",
  pbb: "Bet and called - showdown for 4 chips, high card wins 2",
};

/**
 * A serialisable description of the betting tree, for rendering in the UI.
 * Chance (the deal) is not part of this tree; it sits above the root.
 *
 * Seats are 0 and 1 internally because that is what `history.length % 2` gives,
 * but everything user-facing counts from 1, the way a person at a table would.
 * The translation happens here and nowhere else.
 */
export function gameTree(): TreeNode {
  const build = (history: string): TreeNode => {
    const node: TreeNode = {
      history,
      pot: potSize(history),
      terminal: isTerminal(history),
    };
    if (node.terminal) {
      node.outcome = TERMINAL_DESCRIPTIONS[history];
      node.payoffs = {
        showdown: ["pp", "bb", "pbb"].includes(history),
        amount: Math.abs(terminalUtility(history, [KING, JACK])),
      };
    } else {
      node.player = currentPlayer(history);
      node.children = Object.fromEntries(
        ACTIONS.map((a) => [actionLabel(history, a), build(history + a)]),
      );
    }
    return node;
  };
  return build("");
}
