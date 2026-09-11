// Typed client for the FastAPI backend. Next rewrites /api/* to the Python
// server (see next.config.mjs), so the browser only ever talks to one origin.

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string }>("/api/health"),
  rules: () => request<Rules>("/api/game/rules"),
  infoSets: () => request<{ info_sets: InfoSetInfo[] }>("/api/game/info-sets"),
  theory: (alpha: number) => request<TheoryResponse>(`/api/game/theory?alpha=${alpha}`),
  baselines: () => request<{ baselines: Baseline[] }>("/api/game/baselines"),
  solution: () => request<SolutionReport>("/api/solution"),

  startRun: (variant: string, iterations: number) =>
    request<RunSummary>("/api/runs", {
      method: "POST",
      body: JSON.stringify({ variant, iterations }),
    }),
  getRun: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  stopRun: (id: string) =>
    request<{ stopped: boolean }>(`/api/runs/${id}/stop`, { method: "POST" }),

  ablation: (iterations: number) =>
    request<Ablation>(`/api/ablation?iterations=${iterations}`),
  evaluate: (hands: number, runId?: string) =>
    request<EvaluationResult>("/api/evaluate", {
      method: "POST",
      body: JSON.stringify({ hands, run_id: runId ?? null }),
    }),

  newTable: (opponent: string, humanSeat: number) =>
    request<TableState>("/api/play/tables", {
      method: "POST",
      body: JSON.stringify({ opponent, human_seat: humanSeat }),
    }),
  deal: (id: string) =>
    request<TableState>(`/api/play/tables/${id}/deal`, { method: "POST" }),
  act: (id: string, action: string) =>
    request<TableState>(`/api/play/tables/${id}/act`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
};
