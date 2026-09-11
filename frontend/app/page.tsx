"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type InfoSetInfo, type Rules, type SolutionReport } from "@/lib/api";
import { chips, pct, sci } from "@/lib/format";
import GameTree from "@/components/GameTree";
import PlayingCard from "@/components/PlayingCard";
import Stat from "@/components/Stat";
import StrategyTable from "@/components/StrategyTable";

export default function LearnPage() {
  const [rules, setRules] = useState<Rules | null>(null);
  const [infoSets, setInfoSets] = useState<InfoSetInfo[]>([]);
  const [solution, setSolution] = useState<SolutionReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.rules(), api.infoSets(), api.solution()])
      .then(([r, i, s]) => {
        setRules(r);
        setInfoSets(i.info_sets);
        setSolution(s);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="callout danger">
        <p><strong>Could not reach the solver API.</strong> {error}</p>
        <p className="mono" style={{ fontSize: "0.82rem" }}>
          Start the backend: <code>cd backend &amp;&amp; ./.venv/bin/uvicorn app.main:app --port 8000</code>
        </p>
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <div className="eyebrow">Start here</div>
        <h1>Kuhn poker, and why it is worth solving</h1>
        <p>
          Kuhn poker is the smallest game that is still genuinely poker. Three cards,
          one betting round, two players — and yet it already contains bluffing,
          bluff-catching, and the need to randomise. Small enough that the perfect
          strategy is known on paper; rich enough that the perfect strategy is
          nothing like what your intuition suggests.
        </p>
      </header>

      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>The rules</h2></div>
        <p className="card-sub">A complete hand takes about ten seconds.</p>

        <div style={{ display: "flex", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
          {["J", "Q", "K"].map((c) => <PlayingCard key={c} card={c} />)}
          <div style={{ display: "flex", alignItems: "center", paddingLeft: 10 }}>
            <span className="muted" style={{ fontSize: "0.88rem" }}>
              The whole deck. King beats Queen beats Jack.
            </span>
          </div>
        </div>

        <ol className="clean" style={{ listStyle: "decimal" }}>
          {rules?.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>

        <div className="callout">
          <p>
            <strong>The only thing you can lose is chips you put in.</strong> You ante 1
            no matter what. If you bet and get called you risk 1 more. So every hand
            settles at <span className="mono">±1</span> chip (a check-down or a fold) or{" "}
            <span className="mono">±2</span> chips (a bet that got called).
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>Every way a hand can go</h2></div>
        <p className="card-sub">
          Nine possible betting sequences. That is the entire game — nothing is
          being summarised here.
        </p>
        {rules && <GameTree tree={rules.tree} />}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>What makes it hard</h2></div>
        <p>
          You never see the other card. That single fact breaks every technique that
          works on chess or tic-tac-toe. In chess you can look at the board and ask
          &ldquo;what is the best move here?&rdquo; In poker there is no
          &ldquo;here&rdquo; — you are in one of several situations at once and have
          to pick one action that covers all of them.
        </p>

        <div className="grid grid-3" style={{ marginTop: 18 }}>
          <Stat label="Cards in the deck" value="3" note="J, Q, K" />
          <Stat label="Possible deals" value={rules?.deals ?? "—"} note="each equally likely" />
          <Stat label="Information sets" value={rules?.info_sets ?? "—"} note="6 per player" tone="accent" />
        </div>

        <div className="callout blue">
          <p>
            <strong>An &ldquo;information set&rdquo; is everything you know when it is your
            turn:</strong> your own card, plus the betting so far. If you hold the Queen and
            your opponent has bet, you are in the same information set whether they hold
            the Jack or the King — so you must choose one plan that handles both. There
            are 12 such situations in the whole game. Solving Kuhn poker means finding the
            right answer to all 12.
          </p>
        </div>

        <p>
          And the right answer is usually not a single action. It is a{" "}
          <strong>frequency</strong> — bet this often, call that often. A player who always
          does the same thing in the same spot is readable, and a readable poker player is
          a losing poker player. That is the deep reason the solution has to be random.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>You are mathematically required to bluff</h2></div>
        <p className="card-sub">
          Not as a trick or a &ldquo;mind game&rdquo; — as arithmetic.
        </p>

        <p>
          Suppose you decide, sensibly, to bet only the King. You are never
          &ldquo;caught&rdquo; bluffing and you never throw chips away. Now think about
          what your opponent sees: you bet, therefore you have the King. They fold
          everything else, instantly, forever. Your King never gets paid. And every time
          you hold the Jack, you check and lose at showdown.
        </p>

        <p>
          Betting the Jack changes that. It is a losing card — it wins no showdown
          ever — so its only path to winning a pot is to make a better hand fold.
          Against the &ldquo;bet only the King&rdquo; opponent, the numbers come out:
        </p>

        <div className="formula">
          <span className="cm">// holding the Jack, against an opponent who only ever bets Kings</span><br />
          Check → they check back or bet you off it <span className="hl2">= −1.00 chips</span><br />
          Bet   → they fold the Queen; the King calls <span className="hl">= −0.50 chips</span>
        </div>

        <p>
          Bluffing the worst card in the deck cuts your loss in half. This is the single
          most counterintuitive fact in the game, and it is why every solved poker
          strategy bluffs: the bluff is not a gamble bolted onto a solid strategy, it is
          load-bearing structure.
        </p>

        <div className="callout gold">
          <p>
            <strong>The 3:1 rule.</strong> At equilibrium Player 1 bets the King exactly three
            times as often as the Jack. Why exactly three? Because that is the ratio that
            makes a Queen facing your bet completely indifferent between calling and folding:
          </p>
          <div className="formula" style={{ margin: "12px 0 0" }}>
            <span className="cm">// opponent holds the Queen and faces your bet</span><br />
            Given a bet, you hold J with prob 1/4, K with prob 3/4<br />
            Call → (1/4)(+2) + (3/4)(−2) <span className="hl">= −1.00</span><br />
            Fold → give up the ante <span className="hl">= −1.00</span>
          </div>
          <p style={{ marginTop: 12, marginBottom: 0 }}>
            Dead even. There is no read to make, no tell to find, no adjustment that helps
            them. That is what a solved strategy does — it does not outguess the opponent,
            it removes the guess.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>And you are required to call with a hand that usually loses</h2></div>
        <p>
          The mirror image. When you hold the Queen facing a bet, you beat only the
          Jack. Folding feels right. But if you always fold the Queen, your opponent
          can bet <em>every</em> Jack as a bluff and print chips. So you have to call
          sometimes — and there is exactly one correct frequency:
        </p>

        <div className="formula">
          <span className="cm">// how often must the Queen call to make bluffing pointless?</span><br />
          Bluff succeeds → win the 2-chip pot <span className="hl2">= +1</span><br />
          Bluff gets called → lose ante + bet <span className="hl2">= −2</span><br />
          <br />
          Break-even when: 3·P(fold) − 2 = −1  →  P(fold) <span className="hl">= 1/3</span><br />
          Which requires the Queen to call <span className="hl">exactly 1/3</span> of the time.
        </div>

        <p>
          Call less than 1/3 and bluffing becomes profitable against you. Call more and
          you bleed chips to genuine Kings. One number, and it is not a matter of taste.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>The solved strategy</h2></div>
        <p className="card-sub">
          Computed live by this app&apos;s CFR solver — not hard-coded — then checked
          against the closed-form answer Kuhn published in 1950.
        </p>

        {solution && (
          <div className="grid grid-4" style={{ marginBottom: 24 }}>
            <Stat label="Exploitability" tone="accent"
                  value={sci(solution.exploitability)}
                  note={`${solution.percent_of_ante.toFixed(5)}% of an ante`} />
            <Stat label="Iterations" value={solution.iterations.toLocaleString()}
                  note={`${solution.variant.toUpperCase()} · ${solution.solve_seconds.toFixed(1)}s`} />
            <Stat label="Value to Player 1" tone="danger"
                  value={chips(solution.expected_value, 4)}
                  note="theory says −1/18 = −0.0556" />
            <Stat label="Bluff rate α" tone="gold"
                  value={pct(solution.alpha)}
                  note="how often P1 bets the Jack" />
          </div>
        )}

        {solution && infoSets.length > 0 && (
          <StrategyTable strategy={solution.strategy} infoSets={infoSets} />
        )}

        <div className="callout">
          <p>
            <strong>Read Player 2&apos;s rows carefully.</strong> Bet the Jack 1/3 of the time
            when checked to. Call the Queen 1/3 of the time when bet into. Those exact
            thirds are the numbers derived above — the solver was never told them. It
            found them by playing itself several hundred thousand times and regretting
            its mistakes.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
          <Link href="/play"><button className="primary big">Play a few hands →</button></Link>
          <Link href="/solver"><button className="big">Watch it get solved</button></Link>
          <Link href="/theory"><button className="big">How CFR works</button></Link>
        </div>
      </section>
    </>
  );
}
