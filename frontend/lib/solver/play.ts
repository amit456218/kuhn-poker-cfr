/**
 * Interactive play tables, run entirely in the browser. Port of the table half
 * of `backend/app/store.py`.
 *
 * The human's every decision is scored against the exact best response to the
 * opponent actually being faced, so "you lost 0.17 chips there" is a real
 * number and not a heuristic.
 */

import { actionValues, type ActionValueEntry } from "./bestResponse";
import * as baselines from "./baselines";
import {
  ACTIONS, CARD_CHARS, CARD_NAMES, DEALS,
  actionLabel, currentPlayer, infoSetKey, isTerminal, potSize, terminalUtility,
  type Deal, type Strategy,
} from "./kuhn";

/**
 * A decision counts as a mistake only if it costs at least this many chips per
 * hand. Against an equilibrium opponent almost every action is *deliberately*
 * close to break-even - that is what an equilibrium does - so a threshold of
 * "any loss at all" would flag correct play as a blunder on floating-point
 * dust. Half a percent of an ante is the smallest error worth naming.
 */
export const MISTAKE_THRESHOLD = 0.005;

export interface PlayEvent {
  actor: "you" | "bot";
  action: string;
  label: string;
  history_before: string;
  info_set?: string;
  action_values?: number[] | null;
  best_action?: string | null;
  best_action_label?: string | null;
  ev_lost?: number;
  is_mistake?: boolean;
  strategy?: number[];
}

interface Hand {
  deal: Deal;
  history: string;
  finished: boolean;
  payoffToHuman: number;
  events: PlayEvent[];
}

function randomInt(bound: number): number {
  return Math.floor(Math.random() * bound);
}

export class Table {
  hands_played = 0;
  net_chips = 0;
  ev_lost = 0;
  decisions = 0;
  mistakes = 0;
  completed: { history: string; your_card: string; bot_card: string; payoff: number }[] = [];
  current: Hand | null = null;
  readonly coach: Record<string, ActionValueEntry>;

  constructor(
    readonly id: string,
    readonly opponentName: string,
    readonly opponentStrategy: Strategy,
    readonly humanSeat: number,
  ) {
    // Precomputed once: what each action is worth to the human, at every spot
    // they can face, against this specific opponent.
    this.coach = actionValues(opponentStrategy, humanSeat);
  }

  /** Start a fresh hand and let the bot act until it is the human's turn. */
  deal(): this {
    this.current = {
      deal: DEALS[randomInt(DEALS.length)],
      history: "",
      finished: false,
      payoffToHuman: 0,
      events: [],
    };
    this.advanceBot();
    return this;
  }

  act(action: string): this {
    const hand = this.current;
    if (!hand || hand.finished) throw new Error("no hand in progress; deal first");
    if (!ACTIONS.includes(action)) {
      throw new Error("action must be 'p' (check/fold) or 'b' (bet/call)");
    }
    if (currentPlayer(hand.history) !== this.humanSeat) throw new Error("it is not your turn");

    const key = infoSetKey(hand.deal[this.humanSeat], hand.history);
    const entry = this.coach[key];
    const chosen = ACTIONS.indexOf(action);
    const loss = entry ? entry.loss[chosen] : 0;

    hand.events.push({
      actor: "you",
      action,
      label: actionLabel(hand.history, action),
      history_before: hand.history,
      info_set: key,
      action_values: entry ? [...entry.values] : null,
      best_action: entry ? ACTIONS[entry.best] : null,
      best_action_label: entry ? actionLabel(hand.history, ACTIONS[entry.best]) : null,
      ev_lost: loss,
      is_mistake: loss >= MISTAKE_THRESHOLD,
    });
    this.decisions += 1;
    this.ev_lost += loss;
    if (loss >= MISTAKE_THRESHOLD) this.mistakes += 1;

    hand.history += action;
    this.advanceBot();
    return this;
  }

  /** Play the bot's turns until the human must act or the hand ends. */
  private advanceBot(): void {
    const hand = this.current as Hand;
    const botSeat = 1 - this.humanSeat;

    while (!isTerminal(hand.history) && currentPlayer(hand.history) === botSeat) {
      const key = infoSetKey(hand.deal[botSeat], hand.history);
      const probs = this.opponentStrategy[key];
      const action = Math.random() < probs[0] ? ACTIONS[0] : ACTIONS[1];
      hand.events.push({
        actor: "bot",
        action,
        label: actionLabel(hand.history, action),
        history_before: hand.history,
        info_set: key,
        // Revealed only in the finished-hand summary, never mid-hand - the
        // bot's frequencies for its own card would give it away.
        strategy: [...probs],
      });
      hand.history += action;
    }

    if (isTerminal(hand.history)) this.finish();
  }

  private finish(): void {
    const hand = this.current as Hand;
    const payoffP0 = terminalUtility(hand.history, hand.deal);
    hand.payoffToHuman = this.humanSeat === 0 ? payoffP0 : -payoffP0;
    hand.finished = true;

    this.hands_played += 1;
    this.net_chips += hand.payoffToHuman;
    this.completed.push({
      history: hand.history,
      your_card: CARD_CHARS[hand.deal[this.humanSeat]],
      bot_card: CARD_CHARS[hand.deal[1 - this.humanSeat]],
      payoff: hand.payoffToHuman,
    });
  }

  /** Hide the bot's per-card frequencies until the hand is over. */
  private visibleEvents(hand: Hand): PlayEvent[] {
    return hand.events.map((event) => {
      if (hand.finished || event.actor !== "bot") return { ...event };
      const { strategy, info_set, ...rest } = event;
      return rest;
    });
  }

  state(): TableState {
    const hand = this.current;
    const payload: TableState = {
      table_id: this.id,
      opponent: this.opponentName,
      opponent_description:
        baselines.DESCRIPTIONS[this.opponentName] ?? baselines.NASH_DESCRIPTION,
      human_seat: this.humanSeat,
      session: {
        hands_played: this.hands_played,
        net_chips: this.net_chips,
        chips_per_hand: this.hands_played ? this.net_chips / this.hands_played : 0,
        decisions: this.decisions,
        mistakes: this.mistakes,
        ev_lost: this.ev_lost,
        ev_lost_per_decision: this.decisions ? this.ev_lost / this.decisions : 0,
        accuracy: this.decisions ? 1 - this.mistakes / this.decisions : 1,
      },
      recent: this.completed.slice(-12),
      hand: null,
    };

    if (!hand) return payload;

    const yourCard = hand.deal[this.humanSeat];
    const yourTurn = !hand.finished && currentPlayer(hand.history) === this.humanSeat;

    const handPayload: NonNullable<TableState["hand"]> = {
      history: hand.history,
      finished: hand.finished,
      your_card: CARD_CHARS[yourCard],
      your_card_name: CARD_NAMES[yourCard],
      pot: potSize(hand.history),
      your_turn: yourTurn,
      events: this.visibleEvents(hand),
    };

    if (yourTurn) {
      const key = infoSetKey(yourCard, hand.history);
      const entry = this.coach[key];
      handPayload.info_set = key;
      handPayload.legal_actions = ACTIONS.map((a) => ({
        action: a, label: actionLabel(hand.history, a),
      }));
      // The hint is available but the UI keeps it behind a toggle, so the
      // player can commit to a decision before seeing the answer.
      handPayload.hint = entry
        ? { action_values: [...entry.values], best_action: ACTIONS[entry.best] }
        : null;
    }

    if (hand.finished) {
      const botCard = hand.deal[1 - this.humanSeat];
      handPayload.bot_card = CARD_CHARS[botCard];
      handPayload.bot_card_name = CARD_NAMES[botCard];
      handPayload.payoff = hand.payoffToHuman;
      handPayload.showdown = ["pp", "bb", "pbb"].includes(hand.history);
      handPayload.your_ev_lost = hand.events
        .filter((e) => e.actor === "you")
        .reduce((sum, e) => sum + (e.ev_lost ?? 0), 0);
    }

    payload.hand = handPayload;
    return payload;
  }
}

export interface TableState {
  table_id: string;
  opponent: string;
  opponent_description: string;
  human_seat: number;
  session: {
    hands_played: number;
    net_chips: number;
    chips_per_hand: number;
    decisions: number;
    mistakes: number;
    ev_lost: number;
    ev_lost_per_decision: number;
    accuracy: number;
  };
  recent: { history: string; your_card: string; bot_card: string; payoff: number }[];
  hand: {
    history: string;
    finished: boolean;
    your_card: string;
    your_card_name: string;
    pot: number;
    your_turn: boolean;
    events: PlayEvent[];
    info_set?: string;
    legal_actions?: { action: string; label: string }[];
    hint?: { action_values: number[]; best_action: string } | null;
    bot_card?: string;
    bot_card_name?: string;
    payoff?: number;
    showdown?: boolean;
    your_ev_lost?: number;
  } | null;
}

const TABLES = new Map<string, Table>();

export function createTable(opponent: string, humanSeat: number,
                            nashStrategy: Strategy): Table {
  const known = new Set([...Object.keys(baselines.BASELINES), "nash", "solver", "equilibrium"]);
  if (!known.has(opponent)) {
    throw new Error(`unknown opponent ${opponent}; choose 'nash' or one of: ` +
      Object.keys(baselines.BASELINES).sort().join(", "));
  }
  const strategy = ["nash", "solver", "equilibrium"].includes(opponent)
    ? nashStrategy
    : baselines.get(opponent);
  const id = Math.random().toString(16).slice(2, 14);
  const table = new Table(id, opponent, strategy, humanSeat);
  TABLES.set(id, table);
  return table;
}

export function getTable(id: string): Table {
  const table = TABLES.get(id);
  if (!table) throw new Error("no such table");
  return table;
}
