// Static explainer - no data fetching, so this renders on the server.

export const metadata = { title: "How CFR works" };

export default function TheoryPage() {
  return (
    <>
      <header className="page-head">
        <div className="eyebrow">Method</div>
        <h1>How the solver actually works</h1>
        <p>
          Counterfactual Regret Minimization, from the problem it exists to solve
          through to the two implementation details that decide whether it converges
          fast or slowly. This is the algorithm behind Cepheus, Libratus and Pluribus;
          Kuhn poker is just the smallest game that exercises all of it.
        </p>
      </header>

      {/* ------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>1. Why game-tree search does not work</h2></div>
        <p>
          Minimax and alpha-beta assume you can look at a position and evaluate it.
          Poker denies you that. The value of your situation depends on a card you
          cannot see, so there is no position to evaluate — only a probability
          distribution over positions.
        </p>
        <p>
          Two consequences follow, and both break classical search:
        </p>
        <ul className="clean">
          <li>
            <strong>Decisions cannot be made locally.</strong> Your play with the Queen
            depends on how often you bluff the Jack, because that is what makes your
            bets credible. Subgames do not decompose the way they do in chess.
          </li>
          <li>
            <strong>The optimal strategy is randomised.</strong> Any deterministic
            strategy in Kuhn poker is heavily exploitable — a deterministic bet is a
            readable bet. The answer is a set of frequencies, not a set of moves.
          </li>
        </ul>
        <p>
          Kuhn poker is small enough to solve as a linear program. Real poker is not:
          the LP scales with the number of game states, and heads-up limit hold&apos;em
          has about 10<sup>14</sup>. CFR is the method that scales, and it needs
          nothing but the ability to walk the tree.
        </p>
      </section>

      {/* ------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>2. Information sets and reach probabilities</h2></div>
        <p>
          An information set <span className="mono">I</span> is a set of game states
          the acting player cannot tell apart. In Kuhn poker it is exactly
          &ldquo;my card + the betting so far&rdquo;. There are 12.
        </p>
        <p>
          The key bookkeeping is the <strong>reach probability</strong> — how likely a
          state was to occur — split into three independent factors:
        </p>
        <div className="formula">
          π<sup>σ</sup>(h) = <span className="hl">π<sub>i</sub><sup>σ</sup>(h)</span> ·{" "}
          <span className="hl2">π<sub>−i</sub><sup>σ</sup>(h)</span> · π<sub>c</sub>(h)<br />
          <br />
          <span className="cm">// player i&apos;s own choices, the opponent&apos;s choices, and chance</span>
        </div>
        <p>
          Splitting them is the whole trick. Everything below hinges on being able to
          <em> divide out</em> a player&apos;s own contribution to reaching a decision.
        </p>
      </section>

      {/* ------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>3. Counterfactual value and regret</h2></div>
        <p>
          The <strong>counterfactual value</strong> of an information set weights each
          state by how likely the <em>opponent and chance</em> were to produce it,
          deliberately excluding the player&apos;s own probability of getting there:
        </p>
        <div className="formula">
          v<sub>i</sub><sup>σ</sup>(I) = Σ<sub>h∈I</sub> Σ<sub>z∈Z</sub>{" "}
          <span className="hl2">π<sub>−i</sub><sup>σ</sup>(h)</span> · π<sup>σ</sup>(h,z) · u<sub>i</sub>(z)
        </div>
        <p>
          Why exclude your own reach? Because otherwise a rarely-visited decision would
          look unimportant simply because your current strategy avoids it — and you
          would never discover that it is avoided precisely because you play it badly.
          Dividing out your own probability makes each information set improvable on its
          own terms.
        </p>
        <p>
          <strong>Counterfactual regret</strong> is then the obvious question: how much
          better would always taking action <span className="mono">a</span> have been?
        </p>
        <div className="formula">
          r<sup>t</sup>(I,a) = v<sub>i</sub><sup>σ<sup>t</sup>|<sub>I→a</sub></sup>(I) − v<sub>i</sub><sup>σ<sup>t</sup></sup>(I)<br />
          <br />
          R<sup>T</sup>(I,a) = Σ<sub>t=1..T</sub> r<sup>t</sup>(I,a){"  "}
          <span className="cm">// accumulated over every iteration</span>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>4. Regret matching</h2></div>
        <p>
          Play each action in proportion to how much positive regret it has accumulated.
          Actions you wish you had taken more get taken more.
        </p>
        <div className="formula">
          σ<sup>T+1</sup>(I,a) = R<sup>T,+</sup>(I,a) / Σ<sub>b</sub> R<sup>T,+</sup>(I,b){"   "}
          <span className="cm">// R<sup>+</sup> = max(R, 0)</span><br />
          <span className="cm">// if every regret is ≤ 0, play uniformly</span>
        </div>
        <p>
          That is the entire learning rule. No gradients, no neural network, no opponent
          model. Just: count what you wish you had done, and do more of it.
        </p>
      </section>

      {/* ------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>5. Why this produces a Nash equilibrium</h2></div>
        <p>Two results combine, and neither is obvious on its own:</p>
        <ul className="clean">
          <li>
            <strong>Regret matching is a no-regret algorithm.</strong> Average regret at
            each information set decays like O(1/√T).
          </li>
          <li>
            <strong>Folk theorem for zero-sum games.</strong> If both players&apos; average
            overall regret is below ε, their <em>average</em> strategies form a
            2ε-Nash equilibrium.
          </li>
        </ul>
        <p>
          So minimising a purely local, greedy, per-decision quantity yields a global
          equilibrium of the entire game. The formal guarantee:
        </p>
        <div className="formula">
          R<sub>i</sub><sup>T</sup> / T ≤ Δ · |I<sub>i</sub>| · √|A| / √T<br />
          <br />
          <span className="cm">// Δ = payoff range (4 here), |I| = 6 info sets, |A| = 2 actions</span><br />
          <span className="cm">// ⇒ exploitability decays as O(1/√T)</span>
        </div>

        <div className="callout danger">
          <p style={{ marginBottom: 0 }}>
            <strong>The single most important caveat.</strong> It is the{" "}
            <em>average strategy over all iterations</em> that converges — never the
            current one. Vanilla CFR&apos;s current strategy orbits the equilibrium
            forever and never settles. The solver keeps two separate accumulators for
            exactly this reason, and the ablation on the Solver page measures both so the
            difference is visible rather than asserted.
          </p>
        </div>

        <div className="formula">
          σ̄<sup>T</sup>(I,a) = Σ<sub>t</sub>{" "}
          <span className="hl">π<sub>i</sub><sup>σ<sup>t</sup></sup>(I)</span> σ<sup>t</sup>(I,a)
          {"  "}/{"  "}Σ<sub>t</sub> <span className="hl">π<sub>i</sub><sup>σ<sup>t</sup></sup>(I)</span><br />
          <br />
          <span className="cm">// weighted by the player&apos;s OWN reach — a strategy is only</span><br />
          <span className="cm">// evidence about a spot in proportion to how often you land there</span>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>6. The implementation</h2></div>
        <p>
          One recursive tree walk carries both reach probabilities down and returns
          values back up. Chance is enumerated exactly — all six deals every iteration —
          rather than sampled, which removes Monte-Carlo variance entirely.
        </p>
        <pre className="code">{`def _walk(self, deal, history, reach0, reach1, chance,
          updating_player, regret_weight, average_weight):
    `}<span className="c">{`# returns the expected value to Player 0`}</span>{`
    if is_terminal(history):
        return terminal_utility(history, deal)

    player   = current_player(history)
    node     = self.nodes[info_set_key(deal[player], history)]
    strategy = node.strategy          `}<span className="c">{`# FROZEN for this iteration`}</span>{`

    `}<span className="c">{`# average strategy accumulates weighted by OWN reach`}</span>{`
    own = reach0 if player == 0 else reach1
    node.strategy_sum += own * chance * average_weight * strategy

    `}<span className="c">{`# recurse, threading each player's reach separately`}</span>{`
    action_values = [self._walk(deal, history + a, ...) for a in ACTIONS]
    node_value = dot(strategy, action_values)

    `}<span className="c">{`# regret uses the OPPONENT's reach - the counterfactual weight`}</span>{`
    sign = 1.0 if player == 0 else -1.0
    counterfactual = (reach1 if player == 0 else reach0) * chance
    for i in range(NUM_ACTIONS):
        regret = sign * (action_values[i] - node_value)
        node.regret_delta[i] += counterfactual * regret * regret_weight

    return node_value`}</pre>

        <div className="callout gold">
          <p><strong>Two details in that code decide whether CFR+ is fast or useless.</strong></p>
          <ul className="clean" style={{ marginBottom: 0 }}>
            <li>
              <span className="mono">strategy</span> is read from a snapshot taken once
              per iteration. CFR is defined over a fixed profile σ<sup>t</sup>; letting it
              drift between chance outcomes means each deal is evaluated against a
              slightly different opponent.
            </li>
            <li>
              Regret goes into <span className="mono">regret_delta</span>, not straight
              into the running total. Regret matching+ clamps cumulative regret at zero,
              and that clamp must be applied <em>once per iteration</em> to the full sum
              over all six deals. Clamping after each individual deal lets one chance
              outcome zero the accumulator before another&apos;s contribution arrives.
            </li>
          </ul>
        </div>
        <p>
          Both of these were real bugs in this solver&apos;s first version. Individually
          each looks harmless and still converges to the correct strategy — they simply
          drag CFR+ back to vanilla&apos;s 1/√T rate. Fixing them moved exploitability at
          50,000 iterations from 1.0×10<sup>−3</sup> to 5.8×10<sup>−6</sup>. Both are now
          pinned by regression tests.
        </p>
      </section>

      {/* ------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>7. The variants</h2></div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Variant</th><th>Regret rule</th><th>Averaging</th>
                <th>Updates</th><th>Observed rate</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono" style={{ color: "#58a6ff" }}>vanilla</td>
                <td>regret matching</td><td>uniform</td><td>simultaneous</td>
                <td className="mono">T<sup>−0.52</sup></td>
              </tr>
              <tr>
                <td className="mono" style={{ color: "#34d399" }}>cfr+</td>
                <td>regret matching+ (floor at 0)</td><td>linear in t</td><td>alternating</td>
                <td className="mono">T<sup>−0.88</sup></td>
              </tr>
              <tr>
                <td className="mono" style={{ color: "#a78bfa" }}>linear</td>
                <td>regret matching, weighted by t</td><td>linear in t</td><td>alternating</td>
                <td className="mono">T<sup>−0.9</sup></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="callout">
          <p style={{ marginBottom: 0 }}>
            <strong>Ablation result:</strong> alternating updates — each player responding
            to the opponent&apos;s freshly improved strategy rather than a stale snapshot —
            are worth roughly two orders of magnitude on this game, more than regret
            matching+ contributes on its own. Switching Linear CFR from simultaneous to
            alternating updates alone moved it from 1.2×10<sup>−3</sup> to
            1.7×10<sup>−6</sup> at 50,000 iterations.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>8. Measuring it: exploitability</h2></div>
        <p>
          &ldquo;The strategy stopped changing&rdquo; proves nothing — a solver can
          converge confidently to a non-equilibrium. The real question is what a perfect
          adversary could win:
        </p>
        <div className="formula">
          ε = ( BR<sub>0</sub>(σ<sub>1</sub>) + BR<sub>1</sub>(σ<sub>0</sub>) ) / 2<br />
          <br />
          <span className="cm">// at Nash, BR<sub>0</sub> = v and BR<sub>1</sub> = −v, so ε = 0</span><br />
          <span className="cm">// elsewhere ε &gt; 0 strictly: σ is an ε-Nash equilibrium</span>
        </div>
        <p>
          The subtle part of computing a best response is that the maximisation must
          happen at the <strong>information set</strong>, not at individual game states.
          A best responder still cannot see the private card, so it must commit to one
          action across every deal consistent with what it observes. Taking a max at each
          state separately silently grants clairvoyance and reports exploitability that
          is too high.
        </p>
        <div className="callout blue">
          <p style={{ marginBottom: 0 }}>
            <strong>How this is verified:</strong> Kuhn poker&apos;s equilibria are known in
            closed form, so the test suite feeds five exact equilibria to the
            best-response code and asserts they measure as unexploitable. They come back
            at ~10<sup>−17</sup> — machine zero. A best responder that could peek at the
            opponent&apos;s card would fail that test immediately.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title"><h2>9. What equilibrium does and does not buy you</h2></div>
        <p>
          The most misunderstood property of a Nash strategy, and the most interesting
          measured result in this project: <strong>an equilibrium does not try to win.</strong>
        </p>
        <p>
          It guarantees you cannot lose more than the game value against{" "}
          <em>any</em> opponent. But against a specific flawed opponent it frequently
          earns exactly zero, because equilibrium play makes the opponent{" "}
          <em>indifferent</em> — every option they have is worth the same, so their bad
          habits cost them nothing against it.
        </p>
        <div className="callout gold">
          <p style={{ marginBottom: 0 }}>
            Measured here: the solved equilibrium scores exactly +0.0000 chips/hand
            against three of the seven rule-based baselines, verified across the entire
            α-family — including one that is 0.25 chips/hand exploitable. It is the same
            reason always playing rock scores dead even against a random opponent in
            rock-paper-scissors while being the most exploitable strategy available.
            Punishing a known opponent requires a best response, which wins far more and
            is itself wide open to anyone who adapts.
          </p>
        </div>
        <p style={{ marginBottom: 0 }}>
          That trade — safety versus maximum value — is the real subject of the
          tournament table on the Solver page, and it is why both agents are reported
          side by side rather than picking one number to headline.
        </p>
      </section>
    </>
  );
}
