"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api, type Ablation, type EvaluationResult, type InfoSetInfo,
  type RunDetail, type Snapshot, type TheoryResponse,
} from "@/lib/api";
import { chips, compactInt, pct, sci, signClass } from "@/lib/format";
import LogChart, { type Series } from "@/components/LogChart";
import Stat from "@/components/Stat";
import StrategyTable from "@/components/StrategyTable";

const VARIANT_COLORS: Record<string, string> = {
  vanilla: "#58a6ff",
  "cfr+": "#34d399",
  linear: "#a78bfa",
};

export default function SolverPage() {
  const [variant, setVariant] = useState("cfr+");
  const [iterations, setIterations] = useState(100_000);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [infoSets, setInfoSets] = useState<InfoSetInfo[]>([]);
  const [theory, setTheory] = useState<TheoryResponse | null>(null);
  const [ablation, setAblation] = useState<Ablation | null>(null);
  const [ablationBusy, setAblationBusy] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    api.infoSets().then((r) => setInfoSets(r.info_sets)).catch(() => {});
    return () => streamRef.current?.close();
  }, []);

  // Re-fetch the reference equilibrium at the alpha the solver actually found,
  // so the comparison column lines up with the right member of the family.
  useEffect(() => {
    const alpha = run?.alpha;
    if (alpha === undefined) return;
    api.theory(Math.min(Math.max(alpha, 0), 1 / 3)).then(setTheory).catch(() => {});
  }, [run?.alpha]);

  const train = useCallback(async () => {
    setError(null);
    setSnapshots([]);
    setRun(null);
    setEvaluation(null);
    setRunning(true);
    try {
      const started = await api.startRun(variant, iterations);
      const source = new EventSource(`/api/runs/${started.run_id}/stream`);
      streamRef.current = source;

      source.onmessage = (e) => {
        const snap: Snapshot = JSON.parse(e.data);
        setSnapshots((prev) => [...prev, snap]);
      };
      source.addEventListener("end", async () => {
        source.close();
        streamRef.current = null;
        try {
          setRun(await api.getRun(started.run_id));
        } catch (err) {
          setError(String(err));
        }
        setRunning(false);
      });
      source.onerror = () => {
        source.close();
        streamRef.current = null;
        setRunning(false);
        setError("Lost the connection to the training stream.");
      };
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  }, [variant, iterations]);

  const latest = run?.snapshots?.[run.snapshots.length - 1] ?? snapshots[snapshots.length - 1];
  const progress = latest ? Math.min(1, latest.iteration / iterations) : 0;

  const convergence: Series[] = [
    {
      label: `${variant} — exploitability`,
      color: VARIANT_COLORS[variant] ?? "#34d399",
      points: snapshots.map((s) => ({ x: s.iteration, y: s.exploitability })),
    },
    {
      label: "O(1/√T) reference",
      color: "#61738c",
      dashed: true,
      points: snapshots.length
        ? snapshots.map((s) => ({
            x: s.iteration,
            y: (snapshots[0].exploitability * Math.sqrt(snapshots[0].iteration)) / Math.sqrt(s.iteration),
          }))
        : [],
    },
  ];

  const runAblation = async () => {
    setAblationBusy(true);
    setError(null);
    try {
      setAblation(await api.ablation(20_000));
    } catch (e) {
      setError(String(e));
    }
    setAblationBusy(false);
  };

  const runEvaluation = async () => {
    setEvalBusy(true);
    setError(null);
    try {
      setEvaluation(await api.evaluate(100_000, run?.run_id));
    } catch (e) {
      setError(String(e));
    }
    setEvalBusy(false);
  };

  return (
    <>
      <header className="page-head">
        <div className="eyebrow">Solver</div>
        <h1>Watch an equilibrium converge</h1>
        <p>
          Counterfactual Regret Minimization plays itself, accumulates regret at each
          of the 12 decision points, and steers toward the strategy nobody can beat.
          The chart below is the only honest scoreboard: how much a perfect adversary
          could win against the current answer.
        </p>
      </header>

      {error && <div className="callout danger"><p>{error}</p></div>}

      <section className="card">
        <div className="controls" style={{ marginBottom: 18 }}>
          <label className="field">
            ALGORITHM
            <select value={variant} onChange={(e) => setVariant(e.target.value)} disabled={running}>
              <option value="cfr+">CFR+ (regret matching+, alternating)</option>
              <option value="vanilla">Vanilla CFR (Zinkevich 2007)</option>
              <option value="linear">Linear CFR (Brown &amp; Sandholm 2019)</option>
            </select>
          </label>
          <label className="field">
            ITERATIONS
            <select value={iterations} onChange={(e) => setIterations(Number(e.target.value))} disabled={running}>
              {[1_000, 10_000, 100_000, 250_000, 500_000].map((n) => (
                <option key={n} value={n}>{compactInt(n)}</option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={train} disabled={running}>
            {running ? <><span className="spinner" /> Training…</> : "Train solver"}
          </button>
        </div>

        {running && (
          <div className="progress" style={{ marginBottom: 18 }}>
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        )}

        <div className="grid grid-4" style={{ marginBottom: 22 }}>
          <Stat label="Exploitability" tone="accent"
                value={latest ? sci(latest.exploitability) : "—"}
                note={latest ? `${latest.percent_of_ante.toFixed(5)}% of an ante` : "chips/hand a perfect counter wins"} />
          <Stat label="Iterations"
                value={latest ? latest.iteration.toLocaleString() : "—"}
                note={latest ? `${latest.elapsed_seconds.toFixed(2)}s elapsed` : "self-play passes"} />
          <Stat label="Value to Player 1" tone="danger"
                value={latest ? chips(latest.expected_value) : "—"}
                note="exact answer: −0.05556" />
          <Stat label="Bluff rate α" tone="gold"
                value={latest ? pct(latest.alpha) : "—"}
                note="which equilibrium it landed on" />
        </div>

        <LogChart series={convergence} xLabel="Iterations (log scale)"
                  yLabel="Exploitability, chips/hand (log)" />

        <div className="callout">
          <p>
            <strong>Both axes are logarithmic, on purpose.</strong> Convergence is a power
            law, and a power law is a straight line here. The dashed grey line is the
            theoretical <span className="mono">O(1/√T)</span> rate. Vanilla CFR tracks
            it closely. CFR+ and Linear CFR fall away beneath it — that gap is the
            entire point of those variants, and it is invisible on linear axes.
          </p>
        </div>
      </section>

      {run && theory && infoSets.length > 0 && (
        <section className="card">
          <div className="card-title"><h2>Solved strategy vs. the known answer</h2></div>
          <p className="card-sub">
            Compared against the closed-form equilibrium at α = {run.alpha.toFixed(4)},
            the member of the family the solver converged to. Δ is the gap in
            percentage points.
          </p>
          <StrategyTable strategy={run.strategy} infoSets={infoSets}
                         reference={theory.strategy} referenceLabel="Exact" />
          <div className="grid grid-3">
            <Stat label="Largest deviation" tone="accent"
                  value={`${(Math.max(...Object.values(run.deviation)) * 100).toFixed(3)}pp`}
                  note="worst information set" />
            <Stat label="P1 best-response value"
                  value={chips(run.best_response_value_p0)} note="if seat 1 played perfectly against us" />
            <Stat label="P2 best-response value"
                  value={chips(run.best_response_value_p1)} note="if seat 2 played perfectly against us" />
          </div>
          <div className="callout blue">
            <p>
              <strong>Player 2&apos;s six rows are the real test.</strong> That half of the
              equilibrium is mathematically unique — there is exactly one correct answer
              and no freedom at all. Player 1&apos;s rows are allowed to differ between
              runs, because they form a continuous family indexed by α.
            </p>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-title"><h2>Which parts of CFR+ actually matter</h2></div>
        <p className="card-sub">
          All three variants under an identical 20,000-iteration budget.
        </p>
        <button onClick={runAblation} disabled={ablationBusy}>
          {ablationBusy ? <><span className="spinner" /> Running…</> : "Run ablation"}
        </button>

        {ablation && (
          <>
            <div style={{ marginTop: 20 }}>
              <LogChart
                xLabel="Iterations (log)" yLabel="Exploitability (log)"
                series={ablation.results.map((r) => ({
                  label: r.variant,
                  color: VARIANT_COLORS[r.variant] ?? "#93a4bb",
                  points: r.snapshots.map((s) => ({ x: s.iteration, y: s.exploitability })),
                }))}
              />
            </div>
            <div className="table-scroll" style={{ marginTop: 18 }}>
              <table>
                <thead>
                  <tr>
                    <th>Variant</th><th>Alternating</th><th>Regret matching+</th>
                    <th className="num">Average strategy</th><th className="num">Current strategy</th>
                  </tr>
                </thead>
                <tbody>
                  {ablation.results.map((r) => (
                    <tr key={r.variant}>
                      <td className="mono" style={{ color: VARIANT_COLORS[r.variant] }}>{r.variant}</td>
                      <td>{r.alternating_updates ? "yes" : "no"}</td>
                      <td>{r.regret_matching_plus ? "yes" : "no"}</td>
                      <td className="num pos">{sci(r.final_exploitability)}</td>
                      <td className="num">{sci(r.current_strategy_exploitability)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="callout gold">
              <p>
                <strong>{ablation.speedup?.toFixed(0)}× separation between best and worst</strong>{" "}
                on identical budgets. Note the last column: vanilla CFR&apos;s <em>current</em>{" "}
                strategy never converges — it orbits the equilibrium forever, and only the
                running average settles down. Reporting the current strategy instead of the
                average is the most common way to ship a CFR solver that looks right and is
                not.
              </p>
              <ul className="clean" style={{ marginTop: 12, marginBottom: 0 }}>
                {ablation.findings.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-title"><h2>Performance against rule-based opponents</h2></div>
        <p className="card-sub">
          Exact expected value by enumeration, plus a 100,000-hand simulation with
          confidence intervals. Every matchup is played from both seats.
        </p>
        <button onClick={runEvaluation} disabled={evalBusy}>
          {evalBusy ? <><span className="spinner" /> Playing 100k hands ×7…</> : "Run tournament"}
        </button>

        {evaluation && (
          <>
            <div className="grid grid-4" style={{ margin: "20px 0" }}>
              <Stat label="Equilibrium mean EV" tone="accent"
                    value={chips(evaluation.summary.nash_mean_ev)} note="chips/hand, cannot lose" />
              <Stat label="Equilibrium win rate"
                    value={pct(evaluation.summary.nash_mean_win_rate)} note="card luck dominates this" />
              <Stat label="Exploitative mean EV" tone="gold"
                    value={chips(evaluation.summary.exploitative_mean_ev)} note="best response per opponent" />
              <Stat label="Exploitative win rate" tone="gold"
                    value={pct(evaluation.summary.exploitative_mean_win_rate)} note="maximally adapted" />
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Opponent</th>
                    <th className="num">Their exploitability</th>
                    <th className="num">Nash EV</th>
                    <th className="num">Nash win %</th>
                    <th className="num">Exploitative EV</th>
                    <th className="num">Exploit win %</th>
                    <th className="num">EV left on table</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.results.map((r) => (
                    <tr key={r.opponent}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.label}</div>
                        <div className="muted" style={{ fontSize: "0.76rem" }}>{r.description}</div>
                      </td>
                      <td className="num muted">{r.opponent_exploitability.toFixed(3)}</td>
                      <td className={`num ${signClass(r.nash.ev_per_hand)}`}>{chips(r.nash.ev_per_hand)}</td>
                      <td className="num">{pct(r.nash.simulation.win_rate)}</td>
                      <td className="num pos">{chips(r.exploitative.ev_per_hand)}</td>
                      <td className="num">{pct(r.exploitative.simulation.win_rate)}</td>
                      <td className="num" style={{ color: "var(--gold)" }}>{r.nash.gap.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="callout danger">
              <p>
                <strong>The equilibrium scores exactly zero against several of these,
                and that is correct.</strong> A Nash strategy makes its opponent
                indifferent — every option they have is worth the same, so their bad
                habits cost them nothing <em>against this particular strategy</em>. It is
                the same reason playing rock every time scores exactly even against a
                random opponent in rock-paper-scissors, despite being the most
                exploitable strategy possible.
              </p>
              <p style={{ marginBottom: 0 }}>
                Equilibrium play guarantees you cannot lose. It does not try to win. To
                actually punish a known opponent you need the best response in the
                gold column — which wins far more, and is itself wide open to anyone
                who adapts to it.
              </p>
            </div>

            <div className="table-scroll" style={{ marginTop: 20 }}>
              <table>
                <thead>
                  <tr>
                    <th>Statistical validation</th>
                    <th className="num">Simulated EV</th>
                    <th className="num">95% CI</th>
                    <th className="num">Exact EV</th>
                    <th className="num">Within CI</th>
                    <th className="num">p-value</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.results.map((r) => {
                    const s = r.nash.simulation;
                    return (
                      <tr key={r.opponent}>
                        <td>{r.label}</td>
                        <td className="num">{chips(s.ev_per_hand)}</td>
                        <td className="num muted">[{s.ci95_low.toFixed(3)}, {s.ci95_high.toFixed(3)}]</td>
                        <td className="num">{chips(s.exact_ev_per_hand)}</td>
                        <td className="num">
                          <span className={`chip-tag ${s.exact_within_ci95 ? "good" : "bad"}`}>
                            {s.exact_within_ci95 ? "yes" : "no"}
                          </span>
                        </td>
                        <td className="num muted">{s.p_value < 1e-4 ? "<1e-4" : s.p_value.toFixed(3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: "0.82rem", marginTop: 12 }}>
              The exact EV falling inside the simulation&apos;s own 95% interval on every
              row is the check that the Monte-Carlo path and the enumeration path agree.
              Where the equilibrium is genuinely break-even, a high p-value is the
              correct result, not a weak one.
            </p>
          </>
        )}
      </section>
    </>
  );
}
