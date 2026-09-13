// The dashboard's data layer. Every call is served by the TypeScript solver in
// ./solver, which runs in this browser tab - there is no server behind it.
//
// The method signatures are unchanged from when this was an HTTP client for the
// FastAPI backend, so the pages do not know or care which one they are talking
// to. That backend is still in the repo as the reference implementation, with
// the test suite that pins these numbers down; `npm run parity` checks the two
// against each other.
//
// Calls stay async because solving is genuinely slow enough to matter: long
// runs chunk their work and yield to the event loop so the page keeps painting.
export type Strategy = Record<string, number[]>;

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

export interface RunSummary {
  run_id: string;
  variant: string;
  status: "running" | "done" | "stopped" | "error";
  error: string | null;
  requested_iterations: number;
  iterations: number;
  progress: number;
  latest: Snapshot | null;
}

export interface RunDetail extends RunSummary {
  snapshots: Snapshot[];
  strategy: Strategy;
  current_strategy: Strategy;
  regrets: Strategy;
  alpha: number;
  deviation: Record<string, number>;
  exploitability: number;
  percent_of_ante: number;
  best_response_value_p0: number;
  best_response_value_p1: number;
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

export interface TreeNode {
  history: string;
  pot: number;
  terminal: boolean;
  player?: number;
  outcome?: string;
  children?: Record<string, TreeNode>;
}

export interface Rules {
  name: string;
  deck: { char: string; name: string; rank: number }[];
  ante: number;
  deals: number;
  info_sets: number;
  histories: string[];
  tree: TreeNode;
  steps: string[];
}

export interface Baseline {
  name: string;
  label: string;
  description: string;
  exploitability: number;
  strategy: Strategy;
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

export interface MatchRow {
  opponent: string;
  label: string;
  description: string;
  opponent_exploitability: number;
  nash: {
    ev_per_hand: number;
    ev_as_player0: number;
    ev_as_player1: number;
    equilibrium_ev: number;
    max_exploit_ev: number;
    gap: number;
    simulation: Simulation;
  };
  exploitative: { ev_per_hand: number; simulation: Simulation };
}

export interface EvaluationResult {
  source: { run_id: string | null; iterations: number; variant: string };
  hands_per_matchup: number;
  exploitability: number;
  results: MatchRow[];
  summary: {
    nash_mean_ev: number;
    nash_mean_win_rate: number;
    exploitative_mean_ev: number;
    exploitative_mean_win_rate: number;
  };
  reading_the_table: string[];
}

export interface AblationVariant {
  variant: string;
  alternating_updates: boolean;
  regret_matching_plus: boolean;
  iterations: number;
  snapshots: Snapshot[];
  final_exploitability: number;
  current_strategy_exploitability: number;
  alpha: number;
}

export interface Ablation {
  iterations: number;
  results: AblationVariant[];
  speedup: number | null;
  best_variant: string;
  findings: string[];
}

export interface SolutionReport {
  variant: string;
  iterations: number;
  solve_seconds: number;
  refining: boolean;
  strategy: Strategy;
  alpha: number;
  expected_value: number;
  game_value: number;
  exploitability: number;
  percent_of_ante: number;
  milli_antes_per_hand: number;
  best_response_value_p0: number;
  best_response_value_p1: number;
}

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

export interface TheoryResponse {
  alpha: number;
  alpha_range: number[];
  strategy: Strategy;
  game_value: number;
  expected_value: number;
  exploitability: number;
  notes: string[];
}

import { runtime } from "./solver/runtime";

/** Let the current task finish painting before we start burning CPU. */
const defer = <T>(fn: () => T): Promise<T> =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, 0);
  });

export const api = {
  health: () => defer(() => runtime.health()),
  rules: () => defer(() => runtime.rules() as unknown as Rules),
  infoSets: () => defer(() => runtime.infoSets() as { info_sets: InfoSetInfo[] }),
  theory: (alpha: number) => defer(() => runtime.theory(alpha) as TheoryResponse),
  baselines: () => defer(() => runtime.baselines() as { baselines: Baseline[] }),
  solution: () => defer(() => runtime.solution() as SolutionReport),

  startRun: (variant: string, iterations: number) =>
    defer(() => runtime.startRun(variant, iterations) as RunSummary),
  getRun: (id: string) => defer(() => runtime.getRun(id) as RunDetail),
  /** Snapshots as the solver produces them; replaces the old SSE stream. */
  streamRun: (id: string, handlers: {
    onSnapshot: (snapshot: Snapshot) => void;
    onEnd: () => void;
    onError: (message: string) => void;
  }) => runtime.streamRun(id, handlers),
  stopRun: (id: string) => defer(() => runtime.stopRun(id)),

  ablation: (iterations: number) => runtime.ablation(iterations) as Promise<Ablation>,
  evaluate: (hands: number, runId?: string) =>
    runtime.evaluate(hands, runId) as Promise<EvaluationResult>,

  newTable: (opponent: string, humanSeat: number) =>
    defer(() => runtime.newTable(opponent, humanSeat) as TableState),
  deal: (id: string) => defer(() => runtime.deal(id) as TableState),
  act: (id: string, action: string) => defer(() => runtime.act(id, action) as TableState),
};
