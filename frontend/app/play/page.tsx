"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Baseline, type TableState } from "@/lib/api";
import { chips, describeHistory, pct } from "@/lib/format";
import PlayingCard from "@/components/PlayingCard";
import Stat from "@/components/Stat";

export default function PlayPage() {
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [opponent, setOpponent] = useState("nash");
  const [seat, setSeat] = useState(0);
  const [table, setTable] = useState<TableState | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Prerendered markup ships before React attaches handlers; without this a
  // click in that window is silently dropped. See the same guard on /solver.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    api.baselines().then((r) => setBaselines(r.baselines)).catch(() => {});
  }, []);

  const guard = async (fn: () => Promise<TableState>) => {
    setBusy(true);
    setError(null);
    try {
      setTable(await fn());
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.newTable(opponent, seat);
      setTable(await api.deal(created.table_id));
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  }, [opponent, seat]);

  const hand = table?.hand;
  const yourTurn = !!hand?.your_turn;

  return (
    <>
      <header className="page-head">
        <div className="eyebrow">Play</div>
        <h1>Play against the solver</h1>
        <p>
          Every decision you make is scored against the exact best response to the
          opponent you chose — so &ldquo;that cost you 0.17 chips&rdquo; is a computed
          number, not an opinion. Losing money is normal; losing <em>expected value</em>{" "}
          is the thing to fix.
        </p>
      </header>

      {error && <div className="callout danger"><p>{error}</p></div>}

      <section className="card">
        <div className="controls">
          <label className="field">
            OPPONENT
            <select value={opponent} onChange={(e) => setOpponent(e.target.value)}>
              <option value="nash">Nash equilibrium (CFR-solved)</option>
              {baselines.map((b) => (
                <option key={b.name} value={b.name}>{b.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            YOUR SEAT
            <select value={seat} onChange={(e) => setSeat(Number(e.target.value))}>
              <option value={0}>Player 1 (acts first)</option>
              <option value={1}>Player 2 (acts second)</option>
            </select>
          </label>
          <button className="primary" onClick={start} disabled={busy || !ready}>
            {table ? "New session" : "Sit down"}
          </button>
          <label className="field" style={{ marginLeft: "auto" }}>
            COACHING
            <button onClick={() => setShowHint((v) => !v)}>
              {showHint ? "Hide hints" : "Show hints"}
            </button>
          </label>
        </div>
        {table && (
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 14, marginBottom: 0 }}>
            {table.opponent_description}
          </p>
        )}
      </section>

      {table && hand && (
        <section className="card">
          <div style={{ display: "flex", gap: 40, flexWrap: "wrap", alignItems: "flex-start" }}>
            {/* --- the table ------------------------------------------ */}
            <div style={{ flex: "1 1 340px" }}>
              <div className="stat-label">OPPONENT</div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24 }}>
                <PlayingCard card={hand.bot_card} hidden={!hand.finished} />
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {hand.finished ? hand.bot_card_name : "Face down"}
                  </div>
                  <div className="muted" style={{ fontSize: "0.8rem" }}>
                    {hand.finished ? "revealed" : "you never see this while deciding"}
                  </div>
                </div>
              </div>

              <div style={{
                borderTop: "1px dashed var(--line)", borderBottom: "1px dashed var(--line)",
                padding: "16px 0", margin: "0 0 24px", display: "flex",
                justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div className="stat-label">POT</div>
                  <div className="mono" style={{ fontSize: "1.6rem", fontWeight: 600, color: "var(--gold)" }}>
                    {hand.pot}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="stat-label">ACTION</div>
                  <div className="mono" style={{ fontSize: "0.85rem" }}>
                    {describeHistory(hand.history)}
                  </div>
                </div>
              </div>

              <div className="stat-label">YOUR CARD</div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 22 }}>
                <PlayingCard card={hand.your_card} />
                <div>
                  <div style={{ fontWeight: 600 }}>{hand.your_card_name}</div>
                  <div className="muted" style={{ fontSize: "0.8rem" }}>
                    {hand.your_card === "K" && "the nuts — beats everything"}
                    {hand.your_card === "Q" && "the bluff-catcher — beats only the Jack"}
                    {hand.your_card === "J" && "the worst card — wins no showdown, ever"}
                  </div>
                </div>
              </div>

              {/* --- actions ---------------------------------------- */}
              {yourTurn && hand.legal_actions && (
                <>
                  <div style={{ display: "flex", gap: 12 }}>
                    {hand.legal_actions.map((a) => (
                      <button key={a.action} className={a.action === "b" ? "primary big" : "big"}
                              disabled={busy}
                              onClick={() => guard(() => api.act(table.table_id, a.action))}>
                        {a.label}
                      </button>
                    ))}
                  </div>

                  {showHint && hand.hint && (() => {
                    const values = hand.hint.action_values;
                    // Against an equilibrium opponent the two actions are very
                    // often worth *exactly* the same - that indifference is what
                    // an equilibrium manufactures. Crowning an arbitrary
                    // tie-break as "best" would teach the opposite lesson.
                    const tied = Math.abs(values[0] - values[1]) < 1e-9;
                    return (
                      <div className="callout gold" style={{ marginTop: 18 }}>
                        <p style={{ marginBottom: 8 }}>
                          <strong>What each action is worth here</strong>{" "}
                          <span className="muted">(chips/hand against this opponent)</span>
                        </p>
                        <div className="mono" style={{ fontSize: "0.86rem" }}>
                          {hand.legal_actions!.map((a, i) => (
                            <div key={a.action} style={{
                              color: !tied && hand.hint!.best_action === a.action
                                ? "var(--accent)" : "var(--text-dim)",
                            }}>
                              {a.label.padEnd(6)} {chips(values[i])}
                              {!tied && hand.hint!.best_action === a.action ? "  ← best" : ""}
                            </div>
                          ))}
                        </div>
                        {tied && (
                          <p style={{ marginTop: 10, marginBottom: 0, fontSize: "0.84rem" }}>
                            <strong>Exactly tied.</strong> This opponent has made you
                            indifferent — both actions are worth the same, so neither is a
                            mistake. Manufacturing that indifference is precisely what an
                            equilibrium strategy does, and it is why there is no read to
                            make against one.
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}

              {hand.finished && (
                <div style={{ marginTop: 6 }}>
                  <div className={`callout ${hand.payoff! > 0 ? "" : "danger"}`}>
                    <p style={{ marginBottom: 6 }}>
                      <strong>
                        {hand.payoff! > 0 ? "You win " : "You lose "}
                        {Math.abs(hand.payoff!)} chip{Math.abs(hand.payoff!) === 1 ? "" : "s"}
                      </strong>{" "}
                      — {hand.showdown ? "showdown" : "a fold ended it"}.
                    </p>
                    <p style={{ marginBottom: 0, fontSize: "0.86rem" }}>
                      {hand.your_ev_lost! < 0.005
                        ? "No expected value lost — that line was optimal against this opponent."
                        : `You gave up ${hand.your_ev_lost!.toFixed(3)} chips of expected value.`}
                    </p>
                  </div>
                  <button className="primary big" disabled={busy}
                          onClick={() => guard(() => api.deal(table.table_id))}>
                    Next hand →
                  </button>
                </div>
              )}
            </div>

            {/* --- hand log ------------------------------------------ */}
            <div style={{ flex: "1 1 300px" }}>
              <div className="stat-label" style={{ marginBottom: 10 }}>THIS HAND</div>
              {hand.events.length === 0 && (
                <p className="muted" style={{ fontSize: "0.86rem" }}>No action yet — you are first to act.</p>
              )}
              {hand.events.map((e, i) => (
                <div key={i} style={{
                  borderLeft: `2px solid ${e.actor === "you" ? "var(--blue)" : "var(--gold)"}`,
                  paddingLeft: 12, marginBottom: 14,
                }}>
                  <div style={{ fontSize: "0.86rem" }}>
                    <strong>{e.actor === "you" ? "You" : "Opponent"}</strong> {e.label.toLowerCase()}
                  </div>
                  {e.actor === "you" && e.action_values && (
                    <div className="muted mono" style={{ fontSize: "0.74rem", marginTop: 3 }}>
                      check/fold {chips(e.action_values[0], 3)} · bet/call {chips(e.action_values[1], 3)}
                      {e.is_mistake && (
                        <span className="chip-tag bad" style={{ marginLeft: 8 }}>
                          −{e.ev_lost!.toFixed(3)} EV
                        </span>
                      )}
                    </div>
                  )}
                  {e.actor === "bot" && hand.finished && e.strategy && (
                    <div className="muted mono" style={{ fontSize: "0.74rem", marginTop: 3 }}>
                      its strategy here: {pct(e.strategy[0], 0)} / {pct(e.strategy[1], 0)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {table && table.session.hands_played > 0 && (
        <section className="card">
          <div className="card-title"><h2>Session</h2></div>
          <p className="card-sub">
            Chips swing wildly over a few dozen hands. Decision accuracy is the signal.
          </p>
          <div className="grid grid-4">
            <Stat label="Hands" value={table.session.hands_played} />
            <Stat label="Net chips" tone={table.session.net_chips >= 0 ? "accent" : "danger"}
                  value={chips(table.session.net_chips, 0)}
                  note={`${chips(table.session.chips_per_hand, 3)} per hand`} />
            <Stat label="Decision accuracy" tone="blue"
                  value={pct(table.session.accuracy, 0)}
                  note={`${table.session.mistakes} of ${table.session.decisions} cost real EV`} />
            <Stat label="EV given up" tone="gold"
                  value={table.session.ev_lost.toFixed(3)}
                  note="chips, cumulative" />
          </div>

          {table.recent.length > 0 && (
            <div className="table-scroll" style={{ marginTop: 20 }}>
              <table>
                <thead>
                  <tr>
                    <th>Recent hands</th><th>You</th><th>Them</th>
                    <th>Line</th><th className="num">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {[...table.recent].reverse().map((h, i) => (
                    <tr key={i}>
                      <td className="muted">#{table.session.hands_played - i}</td>
                      <td><PlayingCard card={h.your_card} small /></td>
                      <td><PlayingCard card={h.bot_card} small /></td>
                      <td className="muted" style={{ fontSize: "0.8rem" }}>{describeHistory(h.history)}</td>
                      <td className={`num ${h.payoff > 0 ? "pos" : "neg"}`}>{chips(h.payoff, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!table && (
        <section className="card">
          <div className="card-title"><h3>Which opponent to pick first</h3></div>
          <ul className="clean">
            <li>
              <strong>Nash equilibrium</strong> — you cannot beat it, by construction. The
              best possible result is break-even. Useful for checking your own play, since
              anything you lose is your own error.
            </li>
            <li>
              <strong>Honest</strong> — only ever bets the King. The most instructive one to
              beat: turn on hints and watch it recommend bluffing your Jack.
            </li>
            <li>
              <strong>Calling Station</strong> — never folds. Bluffing is pure loss here, and
              the hints will tell you so.
            </li>
          </ul>
        </section>
      )}
    </>
  );
}
