# Kuhn Poker — Nash Equilibrium Solver

Counterfactual Regret Minimization applied to Kuhn poker, with an exact
exploitability measurement and a Next.js dashboard for watching an equilibrium
converge, playing against it, and being coached on every decision.

Kuhn poker was chosen for one reason: **its Nash equilibria are known in closed
form.** That turns every claim this project makes into something checkable
against ground truth, rather than against a previous run's output.

---

## Results

| Metric | Measured |
| --- | --- |
| Exploitability @ 250K iterations (CFR+) | **1.23 × 10⁻⁶ chips/hand** (0.00012% of an ante) |
| Exploitability @ 100K iterations (CFR+) | 2.14 × 10⁻⁶ chips/hand |
| Solve time, 100K iterations | 6.3 s (pure Python, single core) |
| Game value recovered | −0.055556 (exact: −1/18) |
| Player 2's unique equilibrium | reproduced to < 0.001 absolute error |
| CFR+ vs vanilla CFR at equal budget | **~170× lower exploitability** |
| Tests | 46 passing |

### Against rule-based opponents

Duplicate-scored (every matchup played from both seats to cancel the −1/18
first-player disadvantage), exact EV by enumeration, win rates over 200K
simulated hands:

| Opponent | Their exploitability | Nash EV | Nash win % | Exploitative EV | Exploit win % |
| --- | ---: | ---: | ---: | ---: | ---: |
| Calling Station | 0.333 | +0.1888 | 50.0% | +0.3333 | 49.9% |
| Rock | 1.000 | +0.1888 | 59.4% | +1.0000 | 100.0% |
| Random | 0.458 | +0.1499 | 49.0% | +0.4583 | 68.6% |
| Maniac | 0.333 | +0.1111 | 41.0% | +0.3333 | 50.0% |
| Naive Bluffer | 0.167 | +0.0000 | 45.5% | +0.1667 | 54.0% |
| Tight Aggressive | 0.167 | −0.0000 | 50.1% | +0.1667 | 50.0% |
| Honest | 0.250 | −0.0000 | 54.9% | +0.2500 | 66.7% |
| **Mean** | | **+0.0904** | **50.0%** | **+0.3869** | **62.7%** |

**The equilibrium scores exactly zero against three of these, and that is
correct.** A Nash strategy makes its opponent *indifferent* — every option they
have is worth the same — so it never punishes their errors. Verified to hold
across the entire α-family, including against an opponent that is 0.25
chips/hand exploitable. It is the same reason always playing rock scores dead
even against a random opponent in rock-paper-scissors while being the most
exploitable strategy available.

Equilibrium play guarantees you cannot lose. It does not try to win. Punishing a
known opponent requires the best response — which wins far more and is itself
wide open to anyone who adapts. Both agents are reported side by side for that
reason.

---

## Running it

Two processes. The Next dev server proxies `/api/*` to FastAPI, so the browser
only ever sees one origin.

```bash
# Terminal 1 — solver API
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn app.main:app --reload --port 8000

# Terminal 2 — dashboard
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. API docs at <http://localhost:8000/docs>.

```bash
cd backend && ./.venv/bin/python -m pytest tests/ -q     # 46 tests
```

---

## The four pages

| Page | What it does |
| --- | --- |
| **Learn the game** | Rules, the full betting tree, and why bluffing and bluff-catching are mathematically forced rather than stylistic. Ends with the live solved strategy. |
| **Solver** | Train CFR / CFR+ / Linear CFR with live streamed convergence on log-log axes, compare against the closed-form answer, run the variant ablation and the baseline tournament. |
| **Play** | Play hands against the equilibrium or any baseline. Every decision is scored against the exact best response to that opponent. |
| **How CFR works** | The algorithm from counterfactual value through regret matching to exploitability, including the two implementation details that decide whether CFR+ is fast. |

---

## How it works

CFR is self-play driven by regret. At every decision point it asks a purely
local question — *how much better off would I have been always playing action
`a` here?* — accumulates the answer, and plays each action in proportion to its
positive regret. Two results make that work:

1. Regret matching is a no-regret algorithm; average regret decays as O(1/√T).
2. In a two-player zero-sum game, if both players' average regret is under ε,
   their **average** strategies form a 2ε-Nash equilibrium.

So minimising a local, greedy quantity produces a global equilibrium.

Each regret is weighted by π₋ᵢ — the probability that *chance and the opponent*
would have reached this information set, deliberately excluding the player's own
contribution. Dividing out your own reach is what decouples the information sets
and lets a local update rule solve a global problem.

**It is the time-average that converges, never the current strategy.** Vanilla
CFR's current iterate orbits the equilibrium indefinitely — measured here at
0.22 chips/hand exploitable while its average sits at 0.001. Reporting the
current strategy is the most common way to ship a CFR solver that looks correct
and is not.

### Two bugs worth documenting

Both were real, both were found by the variant ablation, and both are now pinned
by regression tests:

1. **The regret-matching+ zero-floor was applied per chance outcome instead of
   per iteration.** One deal's negative regret could zero the accumulator before
   a later deal's positive contribution arrived.
2. **σᵗ drifted between deals within a single iteration.** CFR is defined over a
   fixed strategy profile per iteration; updating mid-iteration meant each deal
   was evaluated against a slightly different opponent.

Either one alone still converges to the correct strategy — it just silently
drags CFR+ back to vanilla's 1/√T rate. Fixing them moved exploitability at
50,000 iterations from 1.0 × 10⁻³ to 5.8 × 10⁻⁶.

### Ablation

| Variant | Regret rule | Averaging | Updates | Observed rate |
| --- | --- | --- | --- | --- |
| vanilla | regret matching | uniform | simultaneous | T^−0.52 |
| cfr+ | regret matching+ | linear in t | alternating | T^−0.88 |
| linear | weighted by t | linear in t | alternating | T^−0.90 |

**Alternating updates matter more than regret matching+ on this game.** Moving
Linear CFR from simultaneous to alternating updates alone took it from
1.2 × 10⁻³ to 1.7 × 10⁻⁶ at 50,000 iterations — roughly two orders of magnitude
from one scheduling decision.

---

## Verification

The test suite checks against theory, not against itself:

- All five sampled analytical equilibria measure as unexploitable (~10⁻¹⁷,
  machine zero). A best responder that could see the opponent's card would fail
  this immediately.
- Every member of the α-family pays exactly −1/18, which cross-checks the payoff
  table, the tree walk and the analytical strategies simultaneously.
- The solved strategy must reproduce Player 2's *unique* equilibrium and satisfy
  Player 1's 3:1 value-bet-to-bluff ratio.
- Vanilla CFR's average must converge while its current strategy must not.
- Monte-Carlo EV must land inside its own 95% confidence interval around the
  enumerated exact EV, on every matchup.
- The ε-Nash bound is asserted exactly: a strategy measured at exploitability ε
  may lose at most ε per hand to any opponent.

---

## Layout

```
backend/
  app/core/kuhn.py            game rules, 12 information sets, payoffs
  app/core/theory.py          closed-form Nash family — the ground truth
  app/core/cfr.py             CFR / CFR+ / Linear CFR solver
  app/core/best_response.py   exact exploitability + per-action coaching values
  app/core/baselines.py       7 rule-based opponents
  app/core/evaluate.py        duplicate-scored EV, Monte Carlo, CIs, p-values
  app/api/                    game, solver and play routes
  tests/                      46 tests
frontend/
  app/                        4 pages (learn, solver, play, theory)
  components/                 dependency-free log-log chart, strategy tables, cards
  lib/api.ts                  typed client
```

No charting library — the log-log chart is hand-rolled SVG, because convergence
is a power law and the slope is only readable in those coordinates.

---

## References

- Kuhn (1950), *A Simplified Two-Person Poker* — the closed-form solution
- Zinkevich et al. (2007), *Regret Minimization in Games with Incomplete Information* — CFR
- Tammelin (2014), *Solving Large Imperfect Information Games Using CFR+*
- Brown & Sandholm (2019), *Solving Imperfect-Information Games via Discounted Regret Minimization*
- Neller & Lanctot (2013), *An Introduction to Counterfactual Regret Minimization*
